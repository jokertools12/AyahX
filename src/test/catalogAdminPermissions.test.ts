import {describe,it,expect,vi} from 'vitest';
import {RecitationAdminService} from '../../server/services/recitationAdminService';
import type {CatalogDatabase} from '../../server/services/catalogContracts';
import type {CatalogActor} from '../../server/services/catalogAudit';
describe('catalog admin permission boundary',()=>{
  const read=vi.fn(),execute=vi.fn(),transaction=vi.fn();
  const service=new RecitationAdminService({read,execute,transaction} as CatalogDatabase,{validate:vi.fn(),verifySameRecording:vi.fn()});
  const denied:CatalogActor={id:'no-permissions',kind:'human',permissions:new Set()};
  const operations=[
    ()=>service.updatePresentation(denied,'record',{display_label_ar:'اسم'}),
    ()=>service.setDefault(denied,'record'),()=>service.setPublic(denied,'record',true),
    ()=>service.reviewVoice(denied,'record','confirmed','human review'),
    ()=>service.moveRecitation(denied,'record','other','human review'),
    ()=>service.addAlternate(denied,{recitationId:'record',surah:1,url:'https://example.com/audio',priority:0}),
    ()=>service.disableAlternate(denied,'alternate'),()=>service.setAvailabilityMode(denied,'ayah_ranges'),
  ];
  it.each(operations.map((operation,index)=>({index,operation})))('denies operation $index before DB/network',async({operation})=>{
    await expect(operation()).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    expect(read).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled();
  });
  it('system actors cannot confirm a voice, move a reader, add a source or change global mode',async()=>{
    const actor:CatalogActor={id:'system',kind:'system',permissions:new Set(['recitations.voice.review','recitations.move','recitations.sources.manage','settings.catalog.manage'])};
    await expect(service.reviewVoice(actor,'record','confirmed','review')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(service.moveRecitation(actor,'record','other','review')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(service.addAlternate(actor,{recitationId:'record',surah:1,url:'https://example.com/audio',priority:0})).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
    await expect(service.setAvailabilityMode(actor,'ayah_ranges')).rejects.toMatchObject({code:'CATALOG_PERMISSION_DENIED'});
  });
});
