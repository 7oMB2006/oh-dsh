const translations = {
    "zh-CN": {
        star: "星标",
        eyebrow: "DeepSeek Harness 的多端工作台",
        title: "让 Harness 成为你的桌面工作流",
        description:
            "一个可安装、可扩展的工作台，把 Chat、终端、文件、代码审查和插件放进同一个界面。",
        download: "下载最新版",
        source: "查看源代码",
        platforms: "支持 macOS、Windows 与 Linux",
        capabilityOne: "统一工作区",
        capabilityOneDetail: "Chat、终端、文件与审查",
        capabilityTwo: "插件优先",
        capabilityTwoDetail: "可预览、安装与回滚",
        capabilityThree: "配置共享",
        capabilityThreeDetail: "Desktop、Web 与 TUI",
        footer: "开放、可组合的 DeepSeek Harness 工作台",
        screenshotAlt: "Oh-DSH Desktop 深色界面，包含工作区、对话和插件入口",
        pageDescription:
            "Oh-DSH Desktop 是构建在 DeepSeek Harness 之上的可安装、可扩展桌面工作台。",
    },
    en: {
        star: "Star",
        eyebrow: "A multi-surface DeepSeek Harness workbench",
        title: "Make Harness part of your desktop workflow",
        description:
            "An installable, extensible workbench that brings chat, terminals, files, code review, and plugins into one interface.",
        download: "Download latest",
        source: "View source",
        platforms: "Available for macOS, Windows, and Linux",
        capabilityOne: "One workspace",
        capabilityOneDetail: "Chat, terminal, files, and review",
        capabilityTwo: "Plugin first",
        capabilityTwoDetail: "Preview, install, and roll back",
        capabilityThree: "Shared config",
        capabilityThreeDetail: "Desktop, Web, and TUI",
        footer: "An open, composable DeepSeek Harness workbench",
        screenshotAlt:
            "Oh-DSH Desktop dark interface with workspace, conversation, and plugin navigation",
        pageDescription:
            "Oh-DSH Desktop is an installable, extensible workbench built on DeepSeek Harness.",
    },
};

const languageToggle = document.querySelector("[data-language-toggle]");
const descriptionMeta = document.querySelector('meta[name="description"]');
const starCount = document.querySelector("[data-star-count]");
const storageKey = "oh-dsh-site-language";

function preferredLanguage() {
    const saved = window.localStorage.getItem(storageKey);
    if (saved && Object.hasOwn(translations, saved)) {
        return saved;
    }

    return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function applyLanguage(language) {
    const copy = translations[language];

    document.documentElement.lang = language;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const key = element.dataset.i18n;
        if (copy[key]) {
            element.textContent = copy[key];
        }
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
        const key = element.dataset.i18nAlt;
        if (copy[key]) {
            element.alt = copy[key];
        }
    });

    descriptionMeta.content = copy.pageDescription;
    languageToggle.textContent = language === "zh-CN" ? "EN" : "中";
    languageToggle.setAttribute(
        "aria-label",
        language === "zh-CN" ? "Switch to English" : "切换到中文",
    );
    languageToggle.dataset.language = language;
}

languageToggle.addEventListener("click", () => {
    const nextLanguage =
        languageToggle.dataset.language === "zh-CN" ? "en" : "zh-CN";
    window.localStorage.setItem(storageKey, nextLanguage);
    applyLanguage(nextLanguage);
});

fetch("https://api.github.com/repos/hust-open-atom-club/oh-dsh")
    .then((response) => {
        if (!response.ok) {
            throw new Error(`GitHub returned ${response.status}`);
        }
        return response.json();
    })
    .then((repository) => {
        starCount.textContent = new Intl.NumberFormat().format(
            repository.stargazers_count,
        );
        starCount.hidden = false;
    })
    .catch(() => {
        starCount.hidden = true;
    });

applyLanguage(preferredLanguage());
