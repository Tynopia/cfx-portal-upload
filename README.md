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
1. Use the action in your workflow:

   ```yaml
   - name: Upload Escrow Resource
     uses: Tynopia/cfx-portal-upload
     with:
       cookie: ${{ secrets.FORUM_COOKIE }}
       zipPath: /path/to/your/zip
       assetId: 489345
   ```

1. Additionally, you can configure the `chunkSize` option.

> [!IMPORTANT]
>
> When you log out of the forum, the cookie will become invalid, causing the
> action to fail. After configuring the secret, you should clear the cookie from
> your browser and log in again to avoid potential issues.

## Input Parameters

| Key                  | Value                                                     | How to get it                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cookie               | The Forum Cookie to authenticate                          | Go to [forum.cfx.re](https://forum.cfx.re) and inspect the page with your browser's dev tools. Then search for the `_t` cookie.                                                      |
| zipPath              | The path to your ZIP file that should be uploaded         | This is the file location of your packed ZIP file inside the Workflow Container, usually stored in `/home/...`.                                                                      |
| assetId              | The Asset ID, which is a unique ID in the portal          | The Asset ID can be found at [portal.cfx.re](https://portal.cfx.re/assets/created-assets). ![image](https://github.com/user-attachments/assets/4176b7e7-cfbb-4e14-a488-04c4301f6082) |
| chunkSize (Optional) | How large one chunk is for upload. Default: 2097152 bytes |                                                                                                                                                                                      |

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
