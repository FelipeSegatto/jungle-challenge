import { z } from 'zod';

/**
 * Espelha src/presentation/dtos.ts::MoneyDto byte a byte — mesma regex, mesma exigência de 2
 * casas decimais, mesma rejeição de negativo/notação científica. O backend não devolve qual
 * campo falhou num 400 (ver ../../ARCHITECTURE.md), então esta é a única validação com mensagem
 * útil que o usuário vai ver antes de enviar.
 */
export const moneySchema = z.object({
  amount: z
    .string()
    .regex(/^(0|[1-9]\d{0,17})\.\d{2}$/, 'Use um valor decimal positivo com 2 casas, ex.: 25.00'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Moeda deve ter 3 letras maiúsculas, ex.: BRL'),
});

/** Espelha CreateWalletDto. */
export const createWalletSchema = z.object({
  playerId: z.string().uuid('playerId deve ser um UUID válido'),
  initialBalance: moneySchema,
});

const wagerKindSchema = z.enum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']);

/**
 * Espelha ProcessWagerDto. A obrigatoriedade condicional de `referenceExternalTransactionId`
 * (exigido para REFUND/ROLLBACK, proibido para BET/LOSS) é a mesma regra aplicada em
 * src/application/services.ts e src/domain/wager.ts — reproduzida aqui via `.superRefine` para
 * dar feedback antes de bater no servidor, não para substituir a validação do backend.
 */
export const processWagerSchema = z
  .object({
    providerId: z.string().min(1, 'providerId é obrigatório'),
    externalTransactionId: z.string().min(1, 'externalTransactionId é obrigatório'),
    playerId: z.string().uuid('playerId deve ser um UUID válido'),
    walletId: z.string().uuid('walletId deve ser um UUID válido'),
    roundId: z.string().min(1, 'roundId é obrigatório'),
    gameId: z.string().min(1, 'gameId é obrigatório'),
    kind: wagerKindSchema,
    money: moneySchema,
    referenceExternalTransactionId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const requiresReference = value.kind === 'REFUND' || value.kind === 'ROLLBACK';
    const forbidsReference = value.kind === 'BET' || value.kind === 'LOSS';

    if (requiresReference && !value.referenceExternalTransactionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceExternalTransactionId'],
        message: 'REFUND e ROLLBACK exigem referenceExternalTransactionId',
      });
    }
    if (forbidsReference && value.referenceExternalTransactionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceExternalTransactionId'],
        message: 'BET e LOSS não aceitam referenceExternalTransactionId',
      });
    }
    if (
      value.referenceExternalTransactionId &&
      value.referenceExternalTransactionId === value.externalTransactionId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['referenceExternalTransactionId'],
        message: 'Uma operação não pode referenciar a si própria',
      });
    }
  });

export type CreateWalletInput = z.infer<typeof createWalletSchema>;
export type ProcessWagerInput = z.infer<typeof processWagerSchema>;
