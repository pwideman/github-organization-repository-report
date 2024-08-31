import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import "dotenv/config";
import fs from "fs";

const _Octokit = Octokit.plugin(retry, throttling);
const throttle = {
  onRateLimit: (retryAfter, options, octokit, retryCount) => {
    octokit.log.warn(
      `Request quota exhausted for request ${options.method} ${options.url}`
    );
    if (retryCount < 1) {
      octokit.log.info(`Retrying after ${retryAfter} seconds!`);
      return true;
    }
  },
  onSecondaryRateLimit: (retryAfter, options, octokit) => {
    octokit.log.warn(
      `SecondaryRateLimit detected for request ${options.method} ${options.url}`
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
  const promises = [];
  promises.push(
    client.repos
      .getCustomPropertiesValues({
        owner: org,
        repo: repo.name,
      })
      .then((res) => res.data)
  );
  promises.push(
    client.repos
      .listTeams({
        owner: org,
        repo: repo.name,
      })
      .then((res) => res.data)
  );
  promises.push(
    client.repos
      .listCollaborators({
        owner: org,
        repo: repo.name,
      })
      .then((res) => res.data)
  );
  const [_props, teams, users] = await Promise.all(promises);
  const adminTeams = teams.filter((t) => t.permission === "admin");
  const adminUsers = users.filter((u) => u.permissions.admin);

  const line = [`"${repo.name}"`];
  line.push(`"${repo.html_url}"`);
  line.push(`"${repo.description}"`);
  line.push(`"${repo.visibility}"`);
  line.push(`${repo.archived}`);
  line.push(`${repo.is_template}`);
  line.push(`${repo.forks_count}`);
  if (repo.template_repository) {
    line.push(`"${repo.template_repository.full_name}"`);
  } else {
    line.push("");
  }
  line.push(`"${adminTeams.map((t) => t.name).join(",")}"`);
  line.push(`"${adminUsers.map((u) => u.login).join(",")}"`);
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
  const header = [
    '"repo_name"',
    '"url"',
    '"description"',
    '"visibility"',
    '"archived"',
    '"is_template"',
    '"forks"',
    '"from_template"',
    '"admin_teams"',
    '"admin_users"',
  ];
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
    const iterator = client.paginate.iterator(client.rest.repos.listForOrg, {
      org,
      per_page: 100,
    });
    for await (const { data: repos } of iterator) {
      for (const repo of repos) {
        await handleRepo(org, repo, filename, props);
      }
    }
  }
};

main();
