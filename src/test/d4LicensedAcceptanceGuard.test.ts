import {describe,it,expect} from 'vitest';
import {assertLicensedAcceptanceDatabases,assertLocalCloneDdl} from '../../scripts/lib/d4LicensedAcceptanceGuard';
describe('root-run local licensed integration target guards',()=>{
  it('allows a new disposable name and a separate local D3/D4 template',()=>expect(()=>assertLicensedAcceptanceDatabases('ayahx_d4_licensed_acceptance_20261011','ayahx_d4_k9_rehearsal_20261010')).not.toThrow());
  it.each(['railway','production','ayahx_d4_k9_rehearsal_20261010','ayahx_d4_licensed_acceptance_bad-name','ayahx_d4_licensed_acceptance_x;DROP DATABASE railway'])('rejects unsafe target %s',target=>expect(()=>assertLicensedAcceptanceDatabases(target,'ayahx_d4_k9_rehearsal_20261010')).toThrow());
  it.each(['railway','production','mysql','information_schema'])('rejects template outside explicit local namespaces %s',template=>expect(()=>assertLicensedAcceptanceDatabases('ayahx_d4_licensed_acceptance_unit',template)).toThrow());
  it('refuses same target and template before opening a connection',()=>expect(()=>assertLicensedAcceptanceDatabases('ayahx_d4_licensed_acceptance_unit','ayahx_d4_licensed_acceptance_unit')).toThrow('TEMPLATE_MUST_REMAIN_READ_ONLY'));
  it('rejects source-qualified foreign keys and views while retaining exact table DDL',()=>{
    expect(()=>assertLocalCloneDdl('CREATE TABLE `x` (`id` int)','ayahx_d4_template')).not.toThrow();
    expect(()=>assertLocalCloneDdl('CREATE TABLE `x` (`id` int REFERENCES `ayahx_d4_template`.`users`(id))','ayahx_d4_template')).toThrow('CROSS_SCHEMA');
    expect(()=>assertLocalCloneDdl('CREATE TABLE x (id int REFERENCES ayahx_d4_template.users(id))','ayahx_d4_template')).toThrow('CROSS_SCHEMA');
    expect(()=>assertLocalCloneDdl('CREATE TABLE x (id int REFERENCES `railway`.`users`(id))','ayahx_d4_template')).toThrow('CROSS_SCHEMA');
    expect(()=>assertLocalCloneDdl('CREATE VIEW x AS SELECT 1','ayahx_d4_template')).toThrow('BASE_TABLE');
  });
});
