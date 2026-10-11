import type {AdminRegister} from '../../admin/adminContracts';
import type {RenderLabService} from '../../services/renderLabService';
import {RenderManifestV2RequestSchema} from '../../models/renderManifestV2';
export function registerRenderLabEndpoints(register:AdminRegister,service:RenderLabService):void{
  register({method:'post',path:'/render-lab/jobs',permission:'render.test',writes:true,responseStatus:202,body:RenderManifestV2RequestSchema,handler:async ctx=>({data:await service.create(ctx.actor,ctx.body)})});
  register({method:'get',path:'/render-lab/jobs/:id',permission:'render.test',handler:async ctx=>({data:await service.get(ctx.actor,ctx.params.id)})});
}
