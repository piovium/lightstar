import { createWebMiddleware, Webhooks } from "@octokit/webhooks";
import { $, file, YAML, type Serve } from "bun";
import PQueue from "p-queue";

const webhooks = new Webhooks({
  secret: process.env.WEBHOOK_SECRET!,
});
const queue = new PQueue({ concurrency: 1 });

webhooks.on("push", async ({ payload }) => {
  const { repository } = payload;
  if (!repository) {
    console.error({ payload });
    return;
  }

  const { name, clone_url } = repository;
  console.log({ name });

  (async () => {
    await queue.add(async () => {
      console.log({ clone_url });

      await $`rm -rf ${name}`.cwd("stars");
      await $`git clone --depth 1 --recurse-submodules ${clone_url}`.cwd("stars");

      const composeFile = file(`stars/${name}/compose.yaml`);
      const composeText = await composeFile.text();
      const compose = YAML.parse(composeText) as any;
      const composeWithNetwork = {
        ...compose,
        networks: { default: { external: true, name: "infra" } },
      };
      await composeFile.write(YAML.stringify(composeWithNetwork, null, 2));

      const cwd = `stars/${name}`;
      if (name === "infra") {
        await $`docker compose cp Caddyfile caddy:/etc/caddy`.cwd(cwd).nothrow();
        await $`docker compose exec --workdir /etc/caddy caddy caddy reload`.cwd(cwd).nothrow();
        await $`docker compose cp prometheus.yml prometheus:/etc/prometheus`.cwd(cwd).nothrow();
        await $`docker compose kill --signal SIGHUP prometheus`.cwd(cwd).nothrow();
      } else {
        await $`docker compose up --build --detach`.cwd(cwd);
      }

      console.log({ composeWithNetwork });
    });
  })();
});

export default {
  fetch: createWebMiddleware(webhooks),
} satisfies Serve.Options<undefined>;
