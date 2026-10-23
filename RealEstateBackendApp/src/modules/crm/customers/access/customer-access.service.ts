import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../../../common/decorators/current-user.decorator';
import { CrmActor } from '../../common/access/crm-actor';
import { CrmActorService } from '../../common/access/crm-actor.service';
import { buildCustomerScope, CustomerScope } from './customer-scope';

/** Người thực hiện (đọc từ DB) kèm phạm vi khách của họ. */
export interface AccessContext {
  actor: CrmActor;
  scope: CustomerScope;
}

/**
 * `CustomerAccessService` (tài liệu 04 mục 4.3): dựng `CrmActor` từ DB rồi tính `CustomerScope`.
 * Không tin role/team trong JWT — đổi nhóm/vai trò có hiệu lực ngay, tài khoản bị khóa nhận 401.
 */
@Injectable()
export class CustomerAccessService {
  constructor(private readonly actors: CrmActorService) {}

  async resolve(jwt: Pick<JwtPayload, 'sub'>): Promise<AccessContext> {
    const actor = await this.actors.resolve(jwt);
    return { actor, scope: buildCustomerScope(actor) };
  }
}
