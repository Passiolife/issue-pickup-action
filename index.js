const { Toolkit } = require("actions-toolkit");
const ZenHub = require("zenhub-api");

// g1 is the keyword | g2 is issue number without #
const ISSUE_KW =
  /(?:^|(?<= |\t|,|\.|;|"|'|`))(close|closes|closed|fixed|fix|fixes|resolve|resolves|resolved)\s+#(\d+)/gim;

Toolkit.run(async (tools) => {
  const commitList = [];
  const zhApiKey = tools.inputs.zhapikey;
  const zhPipelineName = tools.inputs.zhpipelinename;
  const commentTemplate = tools.inputs.codetemplate;
  const progressorTag = tools.inputs.progresstag;
  var owner = tools.context.repo.owner;
  var repo = tools.context.repo.repo;

  tools.log.info(`event is ${tools.context.event}`);
  // LABEL EVENT
  if (tools.context.event.includes("label")) {
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
    for (let commit of tools.context.payload.commits) {
      let move = false;
      if (commit.message.includes(progressorTag)) {
        move = true;
        break;
      }
      if (!move) {
        tools.exit.neutral(
          `didnt find progressor tag (${progressorTag}) in any incoming commit messages. Exiting.`
        );
        return;
      }      
      // move issue
      const api = new ZenHub(zhApiKey);

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
              issue_number: tools.context.issue.issue_number,
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

          numAttemptMoved += 1;
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
  }

  tools.exit.success(
    `succesfully moved ${numMoved}/${numAttemptMoved} issues to ${zhPipelineName}`
  );
});
