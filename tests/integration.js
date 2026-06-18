/**
 * Minimal integration smoke test.
 * Starts the Express app on an ephemeral port and checks the public health route.
 */

const http = require('http');
const app = require('../src/app');

async function main() {
  const server = app.listen(0);

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    const { port } = server.address();

    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Unexpected status code: ${res.statusCode}`));
            return;
          }

          resolve(data);
        });
      }).on('error', reject);
    });

    const payload = JSON.parse(body);
    if (payload.status !== 'ok') {
      throw new Error(`Unexpected health payload: ${body}`);
    }

    console.log('Integration smoke test passed');
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
