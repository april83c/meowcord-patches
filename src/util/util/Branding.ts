import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Response } from "express";
import { Config } from "./Config";
import { ASSETS_FOLDER } from "./Constants";
import { DEFAULT_AVATAR_COLORS } from "./DefaultAvatars";
import { BrandAssetCache } from "./BrandAssetCache";
import { fetchBrandAsset, readBrandAssetFile, withinBrandImageLimits } from "./BrandAssetRequest";
import { DEFAULT_INSTANCE_NAME } from "../config/types/ClientConfiguration";

export const INSTANCE_ICON_PATH =
    "M12 9.219C12.356 9.219 12.704 9.233 13.046 9.261C13.122 7.687 13.187 6.143 13.435 4.735C13.88 2.211 15.495 0.973 17.095 1.255C18.696 1.537 19.789 3.253 19.344 5.777C19.049 7.446 18.471 9.149 17.94 10.889C19.656 12.039 20.799 13.706 21.118 15.644L23.11 15.021Q23.296 14.963 23.468 15.054Q23.639 15.144 23.698 15.329Q23.756 15.514 23.665 15.686Q23.575 15.858 23.39 15.916L21.21 16.598C21.227 17.219 21.143 17.802 20.968 18.343L23.14 19.021Q23.325 19.079 23.415 19.251Q23.506 19.423 23.448 19.609Q23.389 19.794 23.218 19.884Q23.046 19.974 22.86 19.916L20.589 19.206C19.296 21.519 16.095 22.844 12 22.844C7.905 22.844 4.704 21.519 3.411 19.206L1.14 19.916Q0.954 19.974 0.782 19.884Q0.611 19.794 0.553 19.609Q0.494 19.423 0.585 19.251Q0.675 19.079 0.86 19.021L3.032 18.343C2.857 17.802 2.773 17.219 2.79 16.598L0.61 15.916Q0.425 15.858 0.335 15.686Q0.244 15.514 0.303 15.329Q0.361 15.144 0.532 15.054Q0.704 14.963 0.89 15.021L2.882 15.644C3.201 13.705 4.345 12.037 6.061 10.887C5.526 9.13 4.944 7.41 4.656 5.777C4.211 3.253 5.304 1.537 6.905 1.255C8.505 0.973 10.12 2.211 10.565 4.735C10.818 6.172 10.883 7.704 10.956 9.261C11.297 9.233 11.646 9.219 12 9.219ZM6.625 14.844C6.625 16.19 7.409 17.281 8.375 17.281C9.341 17.281 10.125 16.19 10.125 14.844C10.125 13.497 9.341 12.406 8.375 12.406C7.409 12.406 6.625 13.497 6.625 14.844ZM13.875 14.844C13.875 16.19 14.659 17.281 15.625 17.281C16.591 17.281 17.375 16.19 17.375 14.844C17.375 13.497 16.591 12.406 15.625 12.406C14.659 12.406 13.875 13.497 13.875 14.844Z";
export const DEFAULT_FAVICON_FILE = path.join(ASSETS_FOLDER, "public", "branding", "favicon.svg");

export const DEFAULT_ICON_FILE = path.join(ASSETS_FOLDER, "icon.png");

export type BrandImage = { url: string } | { file: string };

export const resolveBrandImage = (value?: string | null): BrandImage | null => {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return { url: trimmed };
    const file = path.resolve(ASSETS_FOLDER, "..", trimmed);
    return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? { file } : null;
};

export const instanceIcon = () => resolveBrandImage(Config.get().client.icon) ?? resolveBrandImage(Config.get().general.image);

export const instanceLogo = () => resolveBrandImage(Config.get().client.logo);

export const instanceName = () => Config.get().client.instanceName || Config.get().general.instanceName || DEFAULT_INSTANCE_NAME;

export const helpUrl = () => {
    const url = Config.get().client.helpUrl?.trim();
    return url && /^https?:\/\//i.test(url) ? url : null;
};

const fileVersion = (file: string) => {
    const stat = fs.statSync(file, { throwIfNoEntry: false, bigint: true });
    return stat?.isFile() ? `${file}:${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}` : null;
};

const version = (image: BrandImage) =>
    createHash("sha1")
        .update("file" in image ? (fileVersion(image.file) ?? JSON.stringify(image)) : JSON.stringify(image))
        .digest("hex")
        .slice(0, 8);

export const brandImageUrls = () => {
    const icon = instanceIcon();
    const logo = instanceLogo();
    return {
        icon: icon ? `/static/logo.png?v=${version(icon)}` : null,
        logo: logo ? `/static/wordmark?v=${version(logo)}` : null,
    };
};

export const BRAND_COLOR = "#7B5CFF";

export const instanceIconTile = () => {
    const { icon } = brandImageUrls();
    if (icon) return `<img class="brand-icon" src="${escapeXml(icon)}" alt="" />`;
    return `<svg class="brand-icon" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="15" fill="${BRAND_COLOR}"/><g transform="translate(6 6) scale(1.5)" fill="#fff"><path fill-rule="evenodd" d="${INSTANCE_ICON_PATH}"/></g></svg>`;
};

export const brandPage = (html: string) => html.replaceAll("__INSTANCE_NAME__", escapeXml(instanceName())).replaceAll("__INSTANCE_ICON__", instanceIconTile());

export const sendBrandImage = (res: Response, image: BrandImage, cacheControl = "public, max-age=21600") => {
    res.set("Cache-Control", cacheControl);
    if ("url" in image) return res.redirect(302, image.url);
    return res.sendFile(image.file, { cacheControl: false, dotfiles: "allow" });
};

const iconDataUris = new BrandAssetCache<string>();

const MIME_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
};

const fetchDataUri = async (url: string) => {
    const asset = await fetchBrandAsset(url, true);
    return asset ? `data:${asset.type};base64,${asset.data.toString("base64")}` : null;
};

export const instanceIconDataUri = async () => {
    const icon = instanceIcon();
    if (!icon) return null;
    if ("file" in icon) {
        const fingerprint = fileVersion(icon.file);
        if (!fingerprint) return null;
        return iconDataUris.get(`file:${fingerprint}`, async () => {
            const data = await readBrandAssetFile(icon.file);
            return data ? `data:${MIME_TYPES[path.extname(icon.file).toLowerCase()] ?? "image/png"};base64,${data.toString("base64")}` : null;
        });
    }
    return iconDataUris.get(`url:${icon.url}`, () => fetchDataUri(icon.url));
};

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

const iconMarkup = (x: number, y: number, size: number, iconUri: string | null) =>
    iconUri
        ? `<image href="${escapeXml(iconUri)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`
        : `<g fill="#fff" transform="translate(${x} ${y}) scale(${size / 24})"><path fill-rule="evenodd" d="${INSTANCE_ICON_PATH}"/></g>`;

export const wordmarkSvg = (box?: [number, number], iconUri: string | null = null) => {
    const name = instanceName();
    const width = Math.ceil(34 + [...name].length * 12.5);
    const [boxWidth, boxHeight] = box ?? [width, 24];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${boxWidth}" height="${boxHeight}" viewBox="0 0 ${width} 24" fill="none">${iconMarkup(0, 0, 24, iconUri)}<text x="32" y="19.5" fill="#fff" font-family="'gg sans','Noto Sans','Helvetica Neue',Helvetica,Arial,sans-serif" font-size="20" font-weight="800">${escapeXml(name)}</text></svg>`;
};

export const qrLogoSvg = (iconUri: string | null = null) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/>${iconMarkup(23, 23, 54, iconUri)}</svg>`;

export const placeholderAvatarSvg = (size: number, background: string, foreground: string, iconUri: string | null = null) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256"><circle cx="128" cy="128" r="128" fill="${background}"/>${
        iconUri
            ? `<image href="${escapeXml(iconUri)}" x="62" y="62" width="132" height="132" preserveAspectRatio="xMidYMid meet" opacity="0.6"/>`
            : `<g fill="${foreground}" transform="translate(62 62) scale(5.5)"><path fill-rule="evenodd" d="${INSTANCE_ICON_PATH}"/></g>`
    }</svg>`;

export const APP_THEME_COLOR = "#121214";

const appIcons = new BrandAssetCache<Buffer>();

const renderAppIcon = async (image: BrandImage, size: number) => {
    const { Jimp } = await import("jimp");
    const source = "file" in image ? await readBrandAssetFile(image.file) : (await fetchBrandAsset(image.url))?.data;
    if (!source || !withinBrandImageLimits(source)) return null;
    const icon = await Jimp.read(source);
    if ("file" in image && image.file === DEFAULT_ICON_FILE) return icon.resize({ w: size, h: size }).getBuffer("image/png");
    const inner = Math.round(size * 0.62);
    icon.scaleToFit({ w: inner, h: inner });
    const canvas = new Jimp({
        width: size,
        height: size,
        color: parseInt(`${APP_THEME_COLOR.slice(1)}ff`, 16),
    });
    canvas.composite(icon, Math.round((size - icon.bitmap.width) / 2), Math.round((size - icon.bitmap.height) / 2));
    return canvas.getBuffer("image/png");
};

export const appIconPng = (size: number) => {
    if (![180, 192, 512].includes(size)) return Promise.resolve(null);
    const image = instanceIcon() ?? { file: DEFAULT_ICON_FILE };
    const key = `${version(image)}:${size}`;
    return appIcons.get(key, () => renderAppIcon(image, size)).then((png) => png ?? appIcons.get(`default:${size}`, () => renderAppIcon({ file: DEFAULT_ICON_FILE }, size)));
};

export const appIconUrl = (size: number) => `/assets/pwa/icon-${size}.png?v=${version(instanceIcon() ?? { file: DEFAULT_ICON_FILE })}`;

export const appManifest = () => {
    const name = instanceName();
    return {
        id: "/app",
        name,
        short_name: name,
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: APP_THEME_COLOR,
        theme_color: APP_THEME_COLOR,
        icons: [192, 512].flatMap((size) =>
            ["any", "maskable"].map((purpose) => ({
                src: appIconUrl(size),
                sizes: `${size}x${size}`,
                type: "image/png",
                purpose,
            })),
        ),
    };
};

export const defaultAvatarSvg = (index: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="${DEFAULT_AVATAR_COLORS[index % DEFAULT_AVATAR_COLORS.length]}"/><g fill="#fff" transform="translate(53 54) scale(6.25)"><path fill-rule="evenodd" d="${INSTANCE_ICON_PATH}"/></g></svg>`;
