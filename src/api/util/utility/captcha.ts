import type { Request } from "express";
import { Config } from "@spacebar/util";
import { CaptchaRequiredResponse } from "@spacebar/schemas";

export interface CaptchaVerifyResult {
    success: boolean;
    "error-codes"?: string[];
}

export function captchaKeyFrom(req: Request): string | null | undefined {
    return req.get("X-Captcha-Key") || (req.body as { captcha_key?: string | null } | undefined)?.captcha_key;
}

const verifyEndpoints = {
    hcaptcha: "https://hcaptcha.com/siteverify",
    recaptcha: "https://www.google.com/recaptcha/api/siteverify",
};

export function captchaEnabled() {
    const { enabled, service, capMode, sitekey, secret, instance } = Config.get().security.captcha;
    if (!enabled || !service) return false;
    if (service === "cap" && capMode !== "standalone") return true;
    if (!sitekey || !secret) return false;
    if (service !== "cap" && !Config.get().externalRequests.thirdParty) return false;
    return service !== "cap" || !!instance;
}

export function capEndpoint() {
    const { service, capMode, sitekey, instance } = Config.get().security.captcha;
    if (service !== "cap") return null;
    if (capMode !== "standalone") return "/api/v9/auth/cap/";
    if (!sitekey || !instance) return null;
    return `${instance.replace(/\/+$/, "")}/${encodeURIComponent(sitekey!)}/`;
}

const verifyCap = async (response: string, secret: string): Promise<CaptchaVerifyResult> => {
    const res = await fetch(`${capEndpoint()}siteverify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response }),
        signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res) return { success: false, "error-codes": ["captcha-unreachable"] };
    const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        "error-codes"?: string[];
    };
    if (res.ok && body.success === true) return { success: true };
    return {
        success: false,
        "error-codes": body["error-codes"] ?? [body.error ?? "invalid-input-response"],
    };
};

export async function verifyCaptcha(response: string, ip?: string): Promise<CaptchaVerifyResult> {
    const { service, secret, sitekey } = Config.get().security.captcha;

    if (!captchaEnabled() || !service) throw new Error("CAPTCHA is not configured correctly. https://docs.spacebar.chat/setup/server/security/captcha/");

    if (service === "cap") {
        if (Config.get().security.captcha.capMode !== "standalone") {
            const { consumeRegistrationToken } = await import("./localCap.js");
            return { success: await consumeRegistrationToken(response) };
        }
        return verifyCap(response, secret!);
    }

    const res = await fetch(verifyEndpoints[service], {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body:
            `response=${encodeURIComponent(response)}` +
            `&secret=${encodeURIComponent(secret!)}` +
            `&sitekey=${encodeURIComponent(sitekey!)}` +
            (ip ? `&remoteip=${encodeURIComponent(ip)}` : ""),
    });

    return (await res.json()) as CaptchaVerifyResult;
}

export async function checkCaptcha(required: boolean, response: string | null | undefined, ip?: string): Promise<CaptchaRequiredResponse | null> {
    if (!required || !captchaEnabled()) return null;
    const { sitekey, service } = Config.get().security.captcha;
    const challenge = (codes: string[]) => ({
        captcha_key: codes,
        captcha_sitekey: service === "cap" && Config.get().security.captcha.capMode !== "standalone" ? "fosscord" : sitekey!,
        captcha_service: service!,
    });
    if (!response) return challenge(["captcha-required"]);
    const verify = await verifyCaptcha(response, ip);
    return verify.success ? null : challenge(verify["error-codes"] ?? ["invalid-input-response"]);
}

export function registrationCapEndpoint() {
    const captcha = Config.get().security.captcha;
    if (captcha.capMode !== "standalone") return "/api/v9/auth/cap/";
    if (captcha.service !== "cap" || !captcha.instance || !captcha.sitekey || !captcha.secret)
        throw new Error("Cap Standalone needs its server URL, site key and secret before signup can verify accounts");
    return capEndpoint()!;
}

export async function checkRegistrationCaptcha(response: string | null | undefined, consume = true): Promise<CaptchaRequiredResponse | null> {
    if (!Config.get().register.requireCaptcha) return null;
    const endpoint = registrationCapEndpoint();
    const local = endpoint === "/api/v9/auth/cap/";
    const sitekey = local ? "fosscord" : Config.get().security.captcha.sitekey!;
    const challenge = (codes: string[]): CaptchaRequiredResponse => ({
        captcha_key: codes,
        captcha_sitekey: sitekey,
        captcha_service: "cap",
    });
    if (!response || typeof response !== "string" || response.length > 512) return challenge(["captcha-required"]);
    if (local) {
        const { consumeRegistrationToken, registrationTokenAvailable } = await import("./localCap.js");
        return (await (consume ? consumeRegistrationToken(response) : registrationTokenAvailable(response))) ? null : challenge(["invalid-input-response"]);
    }
    const verified = await verifyCap(response, Config.get().security.captcha.secret!);
    return verified.success ? null : challenge(verified["error-codes"] ?? ["invalid-input-response"]);
}
