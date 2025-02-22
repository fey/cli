// @ts-check

const fsp = require('fs/promises');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const debug = require('debug');
const fse = require('fs-extra');
const path = require('path');
const git = require('isomorphic-git');
const chalk = require('chalk');
const { Gitlab } = require('@gitbeaker/node');

const initSettings = require('../../settings.js');

const log = debug('hexlet');

const prepareConfig = async (params) => {
  const {
    hexletConfigPath, gitlabGroupId, gitlabToken, hexletUserId, program, project,
  } = params;

  let data = {};

  fse.ensureDir(path.dirname(hexletConfigPath));
  try {
    if (await fse.pathExists(hexletConfigPath)) {
      data = await fse.readJson(hexletConfigPath);
    }
  } catch (err) {
    // nothing
  }

  data.hexletUserId = hexletUserId;
  data.gitlabToken = gitlabToken;
  if (!data.programs) {
    data.programs = { [program]: {} };
  }
  data.programs[program] = {
    gitlabUrl: project.web_url,
    gitlabGroupId,
  };

  await fse.writeJson(hexletConfigPath, data);
  console.log(chalk.grey(`Config: ${hexletConfigPath}`));
};

const handler = async (params) => {
  const {
    gitlabGroupId, hexletUserId, gitlabToken, customSettings = {},
  } = params;
  log('params', params);

  const {
    author, branch, hexletConfigPath, hexletDir, hexletTemplatesPath,
  } = initSettings(customSettings);

  const api = new Gitlab({
    token: gitlabToken,
  });

  const namespace = await api.Namespaces.show(gitlabGroupId);
  log('namespace', namespace);
  const program = namespace.full_path.split('/')[2];

  const projectId = `${namespace.full_path}/${hexletUserId}`;
  let project;
  try {
    project = await api.Projects.create({
      name: hexletUserId,
      namespace_id: gitlabGroupId,
    });
  } catch (e) {
    log(e);
    project = await api.Projects.show(projectId);
  }
  log('project', project);
  console.log(chalk.grey(`Gitlab repository: ${project.web_url}`));

  prepareConfig({
    ...params, hexletConfigPath, program, project,
  });

  const programTemplateDir = path.join(hexletTemplatesPath, 'program');
  const programTemplatePaths = await fsp.readdir(programTemplateDir);
  const promises = programTemplatePaths.map(async (templatePath) => {
    let action;
    try {
      await api.RepositoryFiles.show(projectId, templatePath, branch);
      action = 'update';
    } catch (e) {
      action = 'create';
    }
    const fullPath = path.join(programTemplateDir, templatePath);
    const content = await fsp.readFile(fullPath, 'utf-8');
    const commitAction = {
      action,
      content,
      filePath: templatePath,
    };
    return commitAction;
  });
  const commitActions = await Promise.all(promises);
  await api.Commits.create(projectId, branch, '@hexlet/cli: configure', commitActions);

  const programPath = path.join(hexletDir, program);
  log(`git clone ${project.ssh_url_to_repo} ${programPath}`);

  await git.clone({
    fs,
    http,
    dir: programPath,
    onAuth: () => ({ username: 'oauth2', password: gitlabToken }),
    url: project.http_url_to_repo,
    singleBranch: true,
    ref: branch,
  });

  await git.pull({
    fs,
    http,
    dir: programPath,
    ref: branch,
    singleBranch: true,
    onAuth: () => ({ username: 'oauth2', password: gitlabToken }),
    author,
  });

  console.log(chalk.grey(`Program name: ${program}`));
  console.log(chalk.grey(`Program path: ${programPath}`));
  console.log();

  console.log(chalk.green(`File structure has been prepared! Follow instructions located at ${programPath}/README.md`));

  return { hexletConfigPath };
};

const obj = {
  command: 'init',
  description: 'Init repository',
  builder: (yargs) => {
    yargs.option('gitlab-token', {
      description: 'Gitlab Token',
      required: true,
      type: 'string',
    });
    // TODO switch to hexlet group id after integration with hexlet
    yargs.option('gitlab-group-id', {
      description: 'Gitlab Group Id',
      required: true,
      type: 'string',
    });
    yargs.option('hexlet-user-id', {
      description: 'Hexlet User Id',
      required: true,
      type: 'string',
    });
  },
  handler,
};

module.exports = obj;
