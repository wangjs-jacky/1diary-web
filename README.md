# 一本日记 Web

PC 浏览器日记应用。React + Vite，IndexedDB 离线优先，连接现有 1Diary API、Supabase Auth 和 OSS 附件服务。

## 本地运行

复制 `.env.example` 为 `.env.local`，填写 Supabase 公共配置后执行：

```bash
pnpm install
pnpm dev
```

登录页支持邮箱密码登录和注册。注册依赖 Supabase Email Provider；开启邮箱确认时，新账号需要先通过验证邮件完成确认。
