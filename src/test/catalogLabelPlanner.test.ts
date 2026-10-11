import {describe,it,expect} from 'vitest';
import {generateCatalogLabels,planCatalogLabels,type LabelCatalogRow} from '../../server/services/catalogLabelPlanner';
const row:LabelCatalogRow={id:'r',slug:'recitation',name_ar:'القارئ',name_en:'Reader',style:'murattal',provider_name:'Provider',recording_year:null,display_label_ar:null,display_label_en:null,needs_label_review:null,human_edited:false};
describe('catalog-only labels',()=>{
  it('does not invent a year',()=>{expect(generateCatalogLabels(row).ar).toBe('القارئ — مرتل — Provider');expect(generateCatalogLabels({...row,recording_year:2008}).en).toBe('Reader — murattal — Provider (2008)');});
  it('leaves human edits and nonempty existing labels unchanged',()=>{expect(planCatalogLabels([{...row,human_edited:true}])[0].patch).toEqual({});expect(planCatalogLabels([{...row,display_label_ar:'اسم أدمن',display_label_en:'Admin label'}])[0].patch).toEqual({});});
  it('does not replace missing metadata or silently translate unknown styles',()=>{expect(()=>generateCatalogLabels({...row,name_ar:''})).toThrow('CATALOG_LABEL_METADATA_INVALID');expect(generateCatalogLabels({...row,style:'new_style'})).toMatchObject({needs_review:true,reasons:['STYLE_TRANSLATION_UNREVIEWED']});});
  it('flags actual legacy Maher style conflict',()=>{expect(planCatalogLabels([{...row,slug:'maher_al_muaiqly_qdc',style:'mujawwad'}])[0]).toMatchObject({patch:{needs_label_review:true},reasons:['LEGACY_MURATTAL_PINNED_QUD_MUJAWWAD']});});
  it('replays unchanged generated data with zero mutations',()=>{const generated=generateCatalogLabels(row);expect(planCatalogLabels([{...row,display_label_ar:generated.ar,display_label_en:generated.en,needs_label_review:0}])[0].patch).toEqual({});});
});
