const repositoryUrl = "https://github.com/hust-open-atom-club/oh-dsh";
const latestReleaseUrl = `${repositoryUrl}/releases/latest`;
const releaseApiUrl =
    "https://api.github.com/repos/hust-open-atom-club/oh-dsh/releases/latest";

const translations = {
    "zh-CN": {
        star: "星标",
        title: "让 Harness 成为你的桌面工作流",
        downloadLatest: "下载最新版",
        downloadMac: "下载 macOS 版",
        downloadWindows: "下载 Windows 版",
        downloadLinux: "下载 Linux 版",
        downloadReady: "准备下载",
        downloadTitle: "下载前，顺手点亮一颗 Star？",
        downloadDescription:
            "Oh-DSH 完全开源。你的 Star 会帮助更多开发者发现它，随后我们会继续下载。",
        detectedPlatform: "已识别当前平台",
        starAndDownload: "去 GitHub Star，并继续下载",
        directDownload: "直接下载",
        unknownPlatform: "其他平台",
        footer: "开放、可组合的 DeepSeek Harness 工作台",
        screenshotAlt: "Oh-DSH Desktop 深色界面，包含工作区、对话和插件入口",
        pageDescription:
            "Oh-DSH Desktop 是构建在 DeepSeek Harness 之上的可安装、可扩展桌面工作台。",
    },
    en: {
        star: "Star",
        title: "Make Harness part of your desktop workflow",
        downloadLatest: "Download latest",
        downloadMac: "Download for macOS",
        downloadWindows: "Download for Windows",
        downloadLinux: "Download for Linux",
        downloadReady: "Ready to download",
        downloadTitle: "Before you go, leave us a Star?",
        downloadDescription:
            "Oh-DSH is fully open source. Your Star helps more developers find it, and your download will continue.",
        detectedPlatform: "Detected platform",
        starAndDownload: "Star on GitHub and continue",
        directDownload: "Download directly",
        unknownPlatform: "Other platform",
        footer: "An open, composable DeepSeek Harness workbench",
        screenshotAlt:
            "Oh-DSH Desktop dark interface with workspace, conversation, and plugin navigation",
        pageDescription:
            "Oh-DSH Desktop is an installable, extensible workbench built on DeepSeek Harness.",
    },
};

const elements = {
    descriptionMeta: document.querySelector('meta[name="description"]'),
    dialog: document.querySelector("[data-download-dialog]"),
    dialogClose: document.querySelector("[data-dialog-close]"),
    directDownload: document.querySelector("[data-direct-download]"),
    downloadTrigger: document.querySelector("[data-download-trigger]"),
    languageToggle: document.querySelector("[data-language-toggle]"),
    platformLabel: document.querySelector("[data-platform-label]"),
    starCount: document.querySelector("[data-star-count]"),
    starDownload: document.querySelector("[data-star-download]"),
};

const storageKey = "oh-dsh-site-language";
const platform = detectPlatform(navigator);
let architecture = detectArchitecture(navigator);

function detectPlatform(browserNavigator) {
    const value = [
        browserNavigator.userAgentData?.platform,
        browserNavigator.platform,
        browserNavigator.userAgent,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (/iphone|ipad/.test(value)) return "unknown";
    if (/mac/.test(value)) return "macos";
    if (/win/.test(value)) return "windows";
    if (/linux|x11/.test(value)) return "linux";
    return "unknown";
}

function detectArchitecture(browserNavigator) {
    const value = [
        browserNavigator.userAgentData?.architecture,
        browserNavigator.userAgent,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (/arm64|aarch64/.test(value)) return "arm64";
    if (/x86_64|x64|win64|wow64|amd64/.test(value)) return "x64";
    return "unknown";
}

function normalizeArchitecture(value) {
    const normalized = String(value ?? "").toLowerCase();
    if (/arm|aarch/.test(normalized)) return "arm64";
    if (/x86|x64|amd/.test(normalized)) return "x64";
    return "unknown";
}

function platformName(language) {
    const names = {
        macos: "macOS",
        windows: "Windows",
        linux: "Linux",
    };
    return names[platform] ?? translations[language].unknownPlatform;
}

function downloadCopyKey() {
    const keys = {
        macos: "downloadMac",
        windows: "downloadWindows",
        linux: "downloadLinux",
    };
    return keys[platform] ?? "downloadLatest";
}

function preferredLanguage() {
    const saved = window.localStorage.getItem(storageKey);
    if (saved && Object.hasOwn(translations, saved)) return saved;
    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function applyLanguage(language) {
    const copy = translations[language];

    document.documentElement.lang = language;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const value = copy[element.dataset.i18n];
        if (value) element.textContent = value;
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
        const value = copy[element.dataset.i18nAlt];
        if (value) element.alt = value;
    });

    elements.descriptionMeta.content = copy.pageDescription;
    elements.downloadTrigger.textContent = copy[downloadCopyKey()];
    elements.platformLabel.textContent = platformName(language);
    elements.languageToggle.textContent = language === "zh-CN" ? "EN" : "中";
    elements.languageToggle.setAttribute(
        "aria-label",
        language === "zh-CN" ? "Switch to English" : "切换到中文",
    );
    elements.languageToggle.dataset.language = language;
}

function chooseReleaseAsset(assets) {
    const safeAssets = assets.filter(
        (asset) => asset.browser_download_url && !/\.blockmap$/i.test(asset.name),
    );
    const platformAssets = safeAssets.filter((asset) => {
        if (platform === "macos") return asset.name.endsWith(".dmg");
        if (platform === "windows") return /\.(exe|msi)$/i.test(asset.name);
        if (platform === "linux") return /\.(AppImage|deb)$/i.test(asset.name);
        return false;
    });
    const architectureAssets = platformAssets.filter((asset) => {
        const name = asset.name.toLowerCase();
        if (architecture === "arm64") return /arm64|aarch64/.test(name);
        if (architecture === "x64") return /x64|x86_64|amd64/.test(name);
        return false;
    });
    const candidates = architectureAssets.length
        ? architectureAssets
        : platformAssets.length === 1
          ? platformAssets
          : [];

    return candidates.sort((left, right) => {
        const score = (asset) => (/\.AppImage$/i.test(asset.name) ? 0 : 1);
        return score(left) - score(right);
    })[0];
}

function setDownloadUrl(url) {
    elements.downloadTrigger.href = url;
    elements.directDownload.href = url;
    elements.starDownload.href = url;
}

elements.languageToggle.addEventListener("click", () => {
    const language =
        elements.languageToggle.dataset.language === "zh-CN" ? "en" : "zh-CN";
    window.localStorage.setItem(storageKey, language);
    applyLanguage(language);
});

elements.downloadTrigger.addEventListener("click", (event) => {
    if (typeof elements.dialog.showModal !== "function") return;
    event.preventDefault();
    elements.dialog.showModal();
});

elements.dialogClose.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) elements.dialog.close();
});

elements.starDownload.addEventListener("click", () => {
    window.open(repositoryUrl, "_blank", "noopener,noreferrer");
});

if (typeof fetch === "function") {
    fetch("https://api.github.com/repos/hust-open-atom-club/oh-dsh")
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((repository) => {
            elements.starCount.textContent = new Intl.NumberFormat().format(
                repository.stargazers_count,
            );
            elements.starCount.hidden = false;
        })
        .catch(() => {
            elements.starCount.hidden = true;
        });

    const architecturePromise = navigator.userAgentData?.getHighEntropyValues
        ? navigator.userAgentData
              .getHighEntropyValues(["architecture"])
              .then((values) => {
                  architecture = normalizeArchitecture(values.architecture);
              })
              .catch(() => {})
        : Promise.resolve();

    architecturePromise
        .then(() => fetch(releaseApiUrl))
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((release) => {
            const asset = chooseReleaseAsset(release.assets ?? []);
            setDownloadUrl(
                asset?.browser_download_url ?? release.html_url ?? latestReleaseUrl,
            );
        })
        .catch(() => setDownloadUrl(latestReleaseUrl));
}

applyLanguage(preferredLanguage());
