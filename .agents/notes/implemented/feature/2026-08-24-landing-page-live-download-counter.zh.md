# Agent Note: 落地页动态展示下载总量

Status: implemented

[English](2026-08-24-landing-page-live-download-counter.md) | 中文

## Problem

GitHub Pages 落地页已经在浏览器端从 GitHub REST API 获取仓库星标数，并按访问者
平台把下载按钮指向最新匹配的 Release 资产。最能体现采用规模的下载总量却完全没有
展示，而 Pages 是纯静态托管，没有服务端组件可以做聚合。

## Decision

- 页头在星标 pill 旁新增下载 pill，链接到 Releases 索引。数字在访问者浏览器中
  对 `GET /repos/…/releases?per_page=100` 返回的每个 release 的每个资产求和
  `download_count`——与星标数相同的未认证 GitHub API，不引入新的基础设施或
  token。
- 聚合结果缓存于 `localStorage`（`oh-dsh-site-downloads`），TTL 30 分钟；TTL 内
  的访问直接用缓存渲染，不发网络请求。缓存损坏或存储被禁用时回退到实时请求。
- 数字首次出现时以 700 ms 数到目标值；`prefers-reduced-motion` 或非正数直接显示
  最终值。任何请求失败都保持计数隐藏——页面绝不显示错误或归零的总量。
- 移动端宽度下与星标计数一同隐藏，沿用既有规则。

## Alternatives considered

**徽章服务（shields.io 之类）。** 不采纳：为一个页面已有 API 就能算出的数字引入
第三方依赖，且视觉风格不一致。

**在 Pages 构建时做服务端聚合。** 不采纳：数字会冻结在部署时刻，只能等下一次
站点构建才更新，无法满足"动态"的要求。

**每次访问都请求、不做缓存。** 不采纳：未认证 GitHub API 对每个客户端 IP 每小时
限 60 次；重复访问者为不变的总量消耗配额是浪费。星标数保持无缓存是因为它先于本
决策如此上线；调整它不属于本决策范围。

**按平台或按 release 拆分展示。** 不采纳：页头 pill 是单一信任信号，更细的数字
属于它链接到的 Releases 页面。

## Consequences

- 仓库 release 数超过 100 后总量会低估，除非扩展查询跟随分页；接近上限时需要
  重新处理。
- TTL 内的访问者看到的总量最多滞后 30 分钟——此处记录为已接受的取舍。
- 下载 pill 与星标 pill 共享 `website/site.css` 的选择器；重设其中一个的样式会
  同时影响两者。
