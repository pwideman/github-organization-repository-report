import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import "dotenv/config";
import fs from "fs";

const _Octokit = Octokit.plugin(retry, throttling);
const throttle = {
  onRateLimit: (retryAfter, options, octokit) => {
    octokit.log.warn(
      `Request quota exhausted for request ${options.method} ${options.url}`
    );
    if (options.request.retryCount === 0) {
      octokit.log.info(`Retrying after ${retryAfter} seconds!`);
      return true;
    }
  },
  onSecondaryRateLimit: (retryAfter, options, octokit) => {
    octokit.log.warn(
      `Abuse detected for request ${options.method} ${options.url}`
    );
    return true;
  },
};

const client = new _Octokit({
  auth: process.env.GITHUB_TOKEN,
  throttle: throttle,
});

const handleRepo = async (org, repo, filename, props) => {
  console.log(`Retrieving repo properties for ${repo.name}`);
  const { data: _props } = await client.repos.getCustomPropertiesValues({
    owner: org,
    repo: repo.name,
  });
  //   const { data: _props } = await client.request(
  //     "GET /repos/{owner}/{repo}/properties/values",
  //     {
  //       owner: org,
  //       repo: repo.name,
  //     }
  //   );
  const line = [`"${repo.name}"`];
  for (const prop of props) {
    const found = _props.find((p) => p.property_name === prop);
    if (!found) {
      line.push("");
    } else {
      line.push(`"${found.value}"`);
    }
  }
  await fs.appendFileSync(filename, line.join(",") + "\n");
};

const main = async () => {
  const org = process.env.ORG;
  const props = process.env.PROPS.split(",");

  const filename = process.env.OUTPUT_FILE;
  const header = ['"repo_name"'];
  for (const prop of props) {
    header.push(`"${prop}"`);
  }
  await fs.writeFileSync(filename, header.join(",") + "\n");

  if (process.env.DEBUG) {
    const { data: repos } = await client.repos.listForOrg({
      org: org,
    });
    for (const repo of repos) {
      await handleRepo(org, repo, filename, props);
    }
  } else {
    const iterator = octokit.paginate.iterator(octokit.rest.repos.listForOrg, {
      org,
      per_page: 100,
    });
    // const repos = await client.paginate("GET /orgs/{org}/repos", {
    //   org: org,
    //   per_page: 100,
    // });

    for await (const { data: repos } of iterator) {
      for (const repo of repos) {
        await handleRepo(org, repo, filename, props);
      }
    }
  }
};

main();
