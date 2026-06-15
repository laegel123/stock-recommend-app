import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3001);
const app = buildApp({ logger: true });

app.listen({ port, host: '0.0.0.0' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
