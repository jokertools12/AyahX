import { defineRailway, project, service } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "ayahX";

export default defineRailway(() => {
  const ayahX = service("ayahX", {
    start: "node node_modules/tsx/dist/cli.mjs server/index.ts",
    healthcheck: "/api/health/ready",
    healthcheckTimeout: 30,
    preDeploy: "npm run db:setup",
    // dockerfilePath from CaC: "Dockerfile"
    // builder from CaC: "DOCKERFILE"
  });
  return project("courteous-recreation", {
    resources: [ayahX],
  });
});
