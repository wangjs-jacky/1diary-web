# 一本日记 Web

PC 浏览器日记应用。React + Vite，IndexedDB 离线优先，连接现有 1Diary API、Supabase Auth 和 OSS 附件服务。

## 本地运行

复制 `.env.example` 为 `.env.local`，填写 Supabase 公共配置后执行：

```bash
pnpm install
pnpm dev
```

登录页支持邮箱密码登录和注册。注册依赖 Supabase Email Provider；开启邮箱确认时，新账号需要先通过验证邮件完成确认。

## CI/CD

GitHub Actions 工作流位于 `.github/workflows/ci-cd.yml`：

- Pull Request 和所有推送到 `main` 的提交执行依赖安装、TypeScript 检查、单元测试和生产构建。
- `main` 质量检查通过后，使用阿里云 AppManager 自动发布到现有 ECS。
- `production` Environment 保证部署串行执行，并记录每次生产发布。
- 发布完成后会核对 AppManager revision，并检查 `http://121.43.32.242:3080/healthz`。

生产 Environment 需要以下 Secrets：

- `ALIBABA_CLOUD_ACCESS_KEY_ID`
- `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
- `APPMANAGER_CONFIG_B64`

可以在 GitHub Actions 页面手动运行 `CI / CD`，也可以使用：

```bash
gh workflow run ci-cd.yml
gh run watch
```
