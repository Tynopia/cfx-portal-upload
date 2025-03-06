# CFX Portal Upload Action

[![GitHub Super-Linter](https://github.com/Tynopia/cfx-portal-upload/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/Tynopia/cfx-portal-upload/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/Tynopia/cfx-portal-upload/actions/workflows/check-dist.yml/badge.svg)](https://github.com/Tynopia/cfx-portal-upload/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/Tynopia/cfx-portal-upload/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/Tynopia/cfx-portal-upload/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

In the past, using CFX Keymaster made it impossible to build CI/CD pipelines for
Escrow Resources due to the Cloudflare Bot Challenge.

However, CFX has now created a new platform called **"Portal"**, which is still
secured via Cloudflare but operates in a less restrictive attack mode, enabling
its use within a GitHub Action.

## How to Use It

To use this action, you need to authenticate via the forum using a cookie until
CFX provides API keys for this action.

1. Go to the **CFX Forum** and inspect the site using your browser's developer
   tools.
1. Navigate to the **Cookies** section and search for `_t`.
1. Copy the value of this cookie and save it in GitHub Secrets as
   `FORUM_COOKIE`.
1. Use the action in your workflow (remember to
   [checkout](https://github.com/actions/checkout) before!):

   ```yaml
   - name: Upload Escrow Resource
     uses: Tynopia/cfx-portal-upload
     with:
       cookie: ${{ secrets.FORUM_COOKIE }}
       assetName: 'my_asset'
   ```

> [!IMPORTANT]
>
> When you log out of the forum, the cookie will become invalid, causing the
> action to fail. After configuring the secret, you should clear the cookie from
> your browser and log in again to avoid potential issues.

## Input Parameters

| Key        | Type     | Value                                                              | Description                                                                                                                                                                          |
| ---------- | -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cookie     | string   | The Forum Cookie to authenticate                                   | Go to [forum.cfx.re](https://forum.cfx.re) and inspect the page with your browser's dev tools. Then search for the `_t` cookie.                                                      |
| makeZip    | boolean? | Automatically ZIP the full repository to upload it (default: true) | This will remove the folders `.git/`/`.github/`/`.vscode/` from the repository before zipping.                                                                                       |
| assetName  | string   | The asset name to re-upload                                        | This is the name of the asset you want to re-upload.                                                                                                                                 |
| assetId    | number   | The Asset ID, which is a unique ID in the portal                   | The Asset ID can be found at [portal.cfx.re](https://portal.cfx.re/assets/created-assets). ![image](https://github.com/user-attachments/assets/4176b7e7-cfbb-4e14-a488-04c4301f6082) |
| zipPath    | string?  | The path to your ZIP file that should be uploaded                  | This is the file location of your packed ZIP file inside the Workflow Container, usually stored in `/home/...`.                                                                      |
| skipUpload | boolean? | Skip the upload and only log in to the portal                      | This will skip the asset upload to the portal and only go through the login process. Useful in cron jobs to prevent the cookie from getting invalidated due to inactivity            |
| maxRetries | number?  | The maximum number of retries. (default: 3)                        | This is the maximum number of times the login will be retried if it fails.                                                                                                           |
| chunkSize  | number?  | How large one chunk is for upload. Default: 2097152 bytes          |                                                                                                                                                                                      |

> [!NOTE]
>
> `?` after the type indicates that the parameter is optional. if no assetName  
> or assetId is provided, the repository name will be used as assetName.

## Skip Upload

If you haven't uploaded an asset in a long time, the cookie will become invalid
due to inactivity. To prevent this, you can use a cron job to log in to the
portal and refresh the cookie.

```yaml
name: Refresh Cookie

on:
  schedule:
    - cron: '0 0 * * *'

jobs:
  - name: Login to Portal
    uses: Tynopia/cfx-portal-upload
    with:
      cookie: ${{ secrets.FORUM_COOKIE }}
      skipUpload: true
```

## How to Contribute

If you want to contribute to this project, you can fork the repository and
create a pull request:

1. Fork the repository.
1. Clone your forked repository.
1. Create a new branch.
1. Make your changes.
1. Push the changes to your fork.
1. Create a pull request.

Contributing helps the CFX community and improves the experience for everyone.

> [!NOTE]
>
> Currently, the project does not have complete unit test coverage. If you want
> to contribute, adding unit tests would be a great starting point.
