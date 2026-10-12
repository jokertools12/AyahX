import type {AdminRegister} from '../../admin/adminContracts';
import type {RenderLabService} from '../../services/renderLabService';
import {RenderManifestV2RequestSchema} from '../../models/renderManifestV2';
import type {AdminRenderMedia} from '../../admin/adminRenderMedia';
export function registerRenderLabEndpoints(register:AdminRegister,service:RenderLabService,media?:AdminRenderMedia):void{
  register({method:'post',path:'/render-lab/jobs',permission:'render.test',writes:true,responseStatus:202,body:RenderManifestV2RequestSchema,handler:async ctx=>({data:await service.create(ctx.actor,ctx.body)})});
  register({method:'get',path:'/render-lab/jobs',permission:'render.test',handler:async ctx=>({data:await service.list(ctx.actor)})});
  register({method:'get',path:'/render-lab/jobs/:id',permission:'render.test',handler:async ctx=>({data:await service.get(ctx.actor,ctx.params.id)})});
  if(media){
    register({method:'get',path:'/render-lab/choices',permission:'render.test',handler:async ctx=>({data:await media.choices(ctx.actor)})});
    register({method:'get',path:'/render-lab/choices/:id',permission:'render.test',handler:async ctx=>({data:await media.chapters(ctx.actor,ctx.params.id)})});
    register({method:'get',path:'/render-lab/choices/:id/:surah',permission:'render.test',handler:async ctx=>({data:await media.ranges(ctx.actor,ctx.params.id,Number(ctx.params.surah))})});
    register({method:'get',path:'/render-lab/jobs/:id/media',permission:'render.test',handler:async()=>({data:null}),respond:(ctx,req,res)=>media.stream(ctx.actor,ctx.params.id,req,res)});
    register({method:'delete',path:'/render-lab/jobs/:id',permission:'render.test',writes:true,handler:async ctx=>({data:await media.remove(ctx.actor,ctx.params.id)})});
  }
}
