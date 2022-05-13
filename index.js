const { Toolkit } = require("actions-toolkit");
const ZenHub = require("zenhub-api");

// g1 is the keyword | g2 is issue number without #
const CLEAN_TITLE_RE = /[^a-zA-Z0-9_-]+/gim;
const ISSUE_KW =
  /(?:^|(?<= |\t|,|\.|;|"|'|`))(close|closes|closed|fixed|fix|fixes|resolve|resolves|resolved)[\s:_-]*#(\d+)/gim;

Toolkit.run(async (tools) => {
  const zhApiKey = tools.inputs.zhapikey;
  const zhPipelineName = tools.inputs.zhpipelinename;
  const zhFromPipelines = tools.inputs.zhfrompipelines;
  const progressorTag = tools.inputs.progresstag;
  var commentTemplate = tools.inputs.codetemplate;
  var owner = tools.context.repo.owner;
  var repo = tools.context.repo.repo;

  tools.log.info(`event is ${tools.context.event}`);
  // LABEL EVENT
  if (tools.context.event.includes("issue")) {
    // get the issue so we have the title
    let issueInfo = await tools.github.issues.get({
      owner: owner,
      repo: repo,
      issue_number: tools.context.issue.issue_number,
    });

    if (issueInfo.status < 200 || issueInfo.status > 299) {
      tools.exit.failure(
        `failed to locate issue: ${JSON.stringify(issueInfo, null, 2)}`
      );
      return;
    }

    // edit the comment
    let title = issueInfo.data.title
      .toString()
      .replace(CLEAN_TITLE_RE, "-")
      .replace(/-+$/, "")
      .toLowerCase();
    commentTemplate = commentTemplate.replace(
      /\<ISSUE_ID\>/g,
      tools.context.issue.issue_number
    );
    commentTemplate = commentTemplate.replace(/\<BRANCH_NAME\>/g, title);

    // add the comment
    let result = await tools.github.issues.createComment({
      owner: owner,
      repo: repo,
      issue_number: tools.context.issue.issue_number,
      body: commentTemplate,
    });

    if (result.status >= 200 && result.status < 300) {
      tools.exit.success(`succesfully commented template to issue`);
      return;
    } else {
      tools.exit.failure(
        `failed to comment: ${JSON.stringify(result, null, 2)}`
      );
      return;
    }
  } else if (tools.context.event.includes("push")) {
    // PUSH EVENT
    // find the move tag, and the issue id
    var move = false;
    var issueId = null;
    for (let commit of tools.context.payload.commits) {
      if (commit.message.includes(progressorTag)) {
        move = true;
      }
      var matches = [...commit.message.matchAll(ISSUE_KW)];
      for (let item of matches) {
        if (item.length >= 3 && item[2].length > 0) {
          issueId = item[2];
        }
      }
    }
    if (!move) {
      tools.exit.success(
        `didnt find progressor tag (${progressorTag}) in any incoming commit messages. Exiting.`
      );
      return;
    }
    if (!issueId) {
      tools.exit.success(
        `didnt find an issue reference in any incoming commit messages. Exiting.`
      );
      return;
    }

    // zenhub!
    const api = new ZenHub(zhApiKey);

    // get the issue, see if its valid to work on
    var zhIssue = null;
    await api
      .getIssueData({
        repo_id: tools.context.payload.repository.id,
        issue_number: issueId,
      })
      .then((data) => {
        zhIssue = data;
      })
      .catch((e) => {
        tools.exit.failure(`unable to retreive zenhub issue: ${e}`);
      });

    if (!zhIssue) {
      tools.exit.failure(`unable to retreive zenhub issue`);
      return;
    }
    var moveable = false;
    // make sure the issues pipeline is in the allowed set of move-out pipelines
    for (let allowedPipe of zhFromPipelines.split(",")) {
      if (
        allowedPipe.trim().toLowerCase() == zhIssue.pipeline.name.toLowerCase()
      ) {
        moveable = true;
      }
    }

    if (!moveable) {
      tools.exit.success(
        `not a candidate for move - current pipeline: ${zhIssue.pipeline.name}`
      );
      return;
    }

    // move issue
    var numMoved = 0;

    // get the board to locate the pipeline by name
    var board = null;
    await api
      .getBoard({ repo_id: tools.context.payload.repository.id })
      .then((data) => {
        board = data;
      })
      .catch((e) => {
        tools.exit.failure(`unable to retreive zenhub board for repo: ${e}`);
      });

    if (board) {
      var targetPipelineId = null;
      for (let p of board.pipelines) {
        if (p.name == zhPipelineName) {
          targetPipelineId = p.id;
          break;
        }
      }

      if (targetPipelineId) {
        // move the issue to the pipeline
        var cpAction = null;
        await api
          .changePipeline({
            repo_id: tools.context.payload.repository.id,
            issue_number: issueId,
            body: {
              pipeline_id: targetPipelineId,
              position: "top",
            },
          })
          .then((data) => {
            // this doesnt return anything... so we increase the count of success here:
            numMoved += 1;
          })
          .catch((e) => {
            if (e) {
              tools.log.error(
                `caught an error when moving issue ${tools.context.issue.issue_number} to ${zhPipelineName}: ${e}`
              );
              numMoved -= 1;
            }
          });
      } else {
        tools.log.info(
          `unable to locate a zenhub pipeline named '${zhPipelineName}'`
        );
      }
    } else {
      tools.log.info(
        `unable to locate a zenhub board for repo: '${repo}' (${tools.context.payload.repository.id})`
      );
    }
  }

  tools.exit.success(
    `succesfully moved ${numMoved} issue to ${zhPipelineName}`
  );
});
