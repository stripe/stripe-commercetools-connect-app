import '@fastify/request-context';
import { ContextData, SessionContextData } from './libs/fastify/context/context';

declare module '@fastify/request-context' {
  interface RequestContextData {
    request: ContextData;
    session?: SessionContextData;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vite: any;
  }

  export interface FastifyRequest {
    correlationId?: string;
  }
}
