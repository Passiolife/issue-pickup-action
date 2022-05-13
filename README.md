# Pull Issue Manager

A Github Action that will find any linked issues in a pull requests main commit or comments, and set the given label on them when the pull is merged to the given branch

## Usage

Create a file named `.github/workflows/issue-pickup-commenter.yaml` (or any name in that directory) with the following content.
Also create the `.github/issue-pickup-template.md` file which contains the comment you want placed on the issue.

## Comment On Issues Labeled

```yaml
name: Issue Pickup Comment
on:
  issues:
    types:
      - labeled
jobs:
  Add-Comment:
    if: github.event.label.name == 'backend' || github.event.label.name == 'frontend'
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - name: Read issue-pickup-template.md
        id: gettemplate
        run: echo "::set-output name=template::$(cat .github/issue-pickup-template.md)"
      - name: Add comment
        uses: Passiolife/issue-pickup-action@v1
        with:
          issuenumber: ${{ github.event.issue.number }}
          codetemplate: ${{ steps.gettemplate.outputs.template }}
          zhapikey: ${{ secrets.ZH_API_TOKEN }}
          zhpipelinename: In Progress
```
