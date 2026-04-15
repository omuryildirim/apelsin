/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
  ORIGIN_HOST_NAME: string;
  ORIGIN_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === 'OPTIONS') {
      const response = new Response();
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
      response.headers.set(
        'Access-Control-Allow-Headers',
        'Authorization, Access-Control-Allow-Headers, Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, X-Device-Id, X-User-Email'
      );
      return response;
    }

    const { pathname, search } = new URL(request.url);
    const url = `${env.ORIGIN_HOST_NAME}${pathname}${search}`;

    const originRequest = new Request(url, request);
    if (env.ORIGIN_SECRET) {
      originRequest.headers.set('X-Origin-Secret', env.ORIGIN_SECRET);
    }

    const response = await fetch(originRequest);

    // Clone the response so that it's no longer immutable
    const newResponse = new Response(response.body, response);

    // Adjust the value for an existing header
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Credentials', 'true');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
    newResponse.headers.set(
      'Access-Control-Allow-Headers',
      'Authorization, Access-Control-Allow-Headers, Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers, X-Device-Id, X-User-Email'
    );
    return newResponse;
  }
};