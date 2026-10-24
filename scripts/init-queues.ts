import 'dotenv/config';
import { ensureQueues, sqsClient } from '../src/infrastructure/sqs/queues';
const client = sqsClient();
try {
    const urls = await ensureQueues(client);
    console.log(JSON.stringify({ event: 'queues_ready', queues: urls }, null, 2));
}
finally {
    client.destroy();
}
