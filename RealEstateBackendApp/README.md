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

## Project setup

```bash
$ npm install
```

## Hạ tầng local (Docker)

`docker-compose.dev.yml` dựng MongoDB (`mongo:7`, Replica Set 1 node `rs0` tự khởi tạo, cổng `127.0.0.1:27017`, không xác thực, dữ liệu ở named volume `mongo_data`), Redis (BullMQ, idempotency; throttler dùng Redis là dự kiến, chưa dùng) và MinIO (S3) + 2 bucket `crm-attachments`, `crm-exports` (exports tự xóa sau 7 ngày). Mọi cổng chỉ bind `127.0.0.1`. NestJS vẫn chạy trên máy host (`npm run start:dev`).

```bash
cp .env.example .env            # lần đầu; rồi điền CRM_PII_ENCRYPTION_KEY (cách sinh ở trong .env.example)
docker compose -f docker-compose.dev.yml up -d --wait   # chờ mongo/redis/minio healthy
docker compose -f docker-compose.dev.yml ps -a          # minio-init "Exited (0)" là bình thường
docker compose -f docker-compose.dev.yml down           # dừng, giữ dữ liệu  (thêm -v để XÓA dữ liệu dev)
```

Kiểm tra nhanh:

```bash
docker exec realestate_dev_mongo mongosh --quiet --eval "rs.status().members.map(m => m.name + ' ' + m.stateStr)"   # [ 'localhost:27017 PRIMARY' ]
docker exec realestate_dev_redis redis-cli ping                                                        # PONG
curl -i http://127.0.0.1:9000/minio/health/live                                                        # 200 OK
# MinIO console: http://localhost:9001  (user/password = S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY, mặc định minioadmin)
```

Lưu ý quan trọng:

- **Luôn dùng `?directConnection=true` trong `MONGODB_URI`** (đã có sẵn trong `.env.example`). Member của replica set được khai báo host `localhost:27017`; `directConnection=true` làm driver nối thẳng `127.0.0.1:27017` thay vì chạy topology discovery. Transaction (`ClientSession`) vẫn dùng được.
- Container `realestate_dev_mongo` phải đang chạy (`docker ps`). Container tay cũ `mongodb` (mongodb-atlas-local) cũng chiếm cổng 27017 nên phải dừng khi dùng compose dev. Stack production `docker-compose.yml` ở gốc repo (Mongo replica set + xác thực, Redis, MinIO) không publish cổng hạ tầng ra host nên không xung đột cổng với stack dev; hướng dẫn triển khai: `docs/01_Infrastructure/06_Production_Deploy.md`.
- Image MinIO mặc định là `cgr.dev/chainguard/minio:latest` (image `minio/minio` trên Docker Hub/quay.io không còn pull được). Muốn pin/đổi nguồn: đặt `MINIO_IMAGE` trong `.env`.
- Bật module để thử local: `FEATURE_CRM_ENABLED=true` trong `.env` (mặc định tắt).

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
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
