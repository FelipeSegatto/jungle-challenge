import { EntityManager } from '@mikro-orm/postgresql';
import { WagerRow } from '../entities/rows';
import { WagerService } from '../../application/services';
/** Select without claiming: each reprocessor locks wallet -> pending row inside its transaction. */
export async function retryReferences(root: EntityManager, limit = 20): Promise<number> {
    const rows = await root.fork().find(WagerRow, {
        status: 'PENDING_REFERENCE',
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
    }, { orderBy: { createdAt: 'ASC', id: 'ASC' }, limit, fields: ['id'] });
    let processed = 0;
    for (const row of rows) {
        const result = await new WagerService(root.fork()).retryPendingReference(row.id, Number(process.env.REFERENCE_MAX_ATTEMPTS ?? '10'));
        if (result === 'processed' || result === 'rejected')
            processed++;
    }
    return processed;
}
