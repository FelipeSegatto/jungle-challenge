import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
/** Extensão explícita: substituir por validação OIDC/JWT com Keycloak no futuro.
 *  NÃO constitui autenticação. Omite-se propositalmente pelo timebox do case. */
@Injectable()
export class NoopAuthGuard implements CanActivate {
    canActivate(_context: ExecutionContext): boolean { return true; }
}
