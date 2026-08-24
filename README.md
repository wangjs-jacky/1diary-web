# 一本日记 Web

PC 浏览器日记应用。React + Vite，IndexedDB 离线优先，连接现有 1Diary API、Supabase Auth 和 OSS 附件服务。

## 本地运行

复制 `.env.example` 为 `.env.local`，填写 Supabase 公共配置后执行：

```bash
pnpm install
pnpm dev
```

不提供注册入口；账号由 Supabase 后台预先创建。
