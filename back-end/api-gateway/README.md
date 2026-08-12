<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Health Checks

The gateway exposes three endpoints under `/health`:

- `GET /health` — aggregated status of every dependency in one response. Always `200`; check the `status` field.
- `GET /health/live` — liveness: is the gateway *process* running. Always `200`, no downstream calls.
- `GET /health/ready` — readiness: can the gateway currently *serve requests*. `200` when ready, `503` when a critical dependency is down.

### Why liveness and readiness are different

Liveness answers "is the process alive" — a process manager (or Docker's own `HEALTHCHECK`) uses this to decide whether to restart the container. It never calls out to anything, because a slow dependency should never cause a healthy process to be killed and restarted.

Readiness answers "can this process currently do its job" — it's what should gate traffic. A gateway with a dead RabbitMQ connection is alive but not ready: restarting it would not help, but it also shouldn't receive requests it cannot fulfill.

### Critical vs informational dependencies

`/health/ready` treats **RabbitMQ, Service A, and Service B** as critical — the gateway's only purpose is routing requests to those services through the broker, so if any of them is unreachable, `/health/ready` returns `503`.

**MongoDB and Redis** are reported for visibility but are informational only — nothing in the gateway's request path uses them today (there is no persistence layer or caching configured), so their failure never causes `/health/ready` to fail.

### Why the gateway never accesses Service A/B's databases directly

The gateway has no visibility into, or dependency on, Service A/B's internal storage. Checking their databases directly would violate the module boundary (each service owns its own persistence) and would report "healthy" even if the service's own RabbitMQ consumer had crashed — the opposite of what a caller needs to know. Instead, the gateway sends a dedicated `health.check` RabbitMQ message to each service and waits (with a timeout) for a reply — the same transport and pattern used for every other inter-service call, exercising the actual path a real request would take.

### Example responses

`GET /health` — everything healthy:

```json
{
  "status": "ok",
  "services": {
    "gateway": "ok",
    "rabbitmq": "ok",
    "serviceA": "ok",
    "serviceB": "ok",
    "mongodb": "ok",
    "redis": "ok"
  }
}
```

`GET /health` — Service B unreachable:

```json
{
  "status": "degraded",
  "services": {
    "gateway": "ok",
    "rabbitmq": "ok",
    "serviceA": "ok",
    "serviceB": "unavailable",
    "mongodb": "ok",
    "redis": "ok"
  }
}
```

`GET /health/live`:

```json
{ "status": "ok", "service": "gateway" }
```

`GET /health/ready` — not ready (`503`, Service A down):

```json
{
  "status": "degraded",
  "services": {
    "gateway": "ok",
    "rabbitmq": "ok",
    "serviceA": "unavailable",
    "serviceB": "ok",
    "mongodb": "ok",
    "redis": "ok"
  }
}
```

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
