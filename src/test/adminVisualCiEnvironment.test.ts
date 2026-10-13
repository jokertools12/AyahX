// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {pinAdminVisualCiEnvironment} from '../../tooling/e2e/helpers/adminVisualCiEnvironment.mjs';

describe('disposable admin visual global environment',()=>{
 it('overrides inherited database and queue endpoints before config import',()=>{
  const env:NodeJS.ProcessEnv={CI:'true',AYAHX_ADMIN_VISUAL_CI:'1',MYSQL_HOST:'external.invalid',MYSQL_PORT:'3306',MYSQL_USER:'external',MYSQL_PASSWORD:'external',MYSQL_DATABASE:'external',REDIS_URL:'redis://external.invalid:6379',OBJECT_STORAGE_DRIVER:'s3',OBJECT_STORAGE_ENDPOINT:'https://external.invalid'};
  pinAdminVisualCiEnvironment(env);
  expect([env.MYSQL_HOST,env.MYSQL_PORT,env.MYSQL_USER,env.MYSQL_PASSWORD,env.MYSQL_DATABASE]).toEqual(['127.0.0.1','33319','root','','ayahx_ci_admin_visual']);
  expect(env.REDIS_URL).toBe('redis://127.0.0.1:6380/15');
  expect(env.OBJECT_STORAGE_DRIVER).toBe('local');expect(env.OBJECT_STORAGE_ENDPOINT).toBe('');
  expect(env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
 });
 it('rejects external URL-style credentials instead of concealing them',()=>{
  for(const name of ['DATABASE_URL','MYSQL_URL','RAILWAY_ENVIRONMENT_ID'])expect(()=>pinAdminVisualCiEnvironment({CI:'true',AYAHX_ADMIN_VISUAL_CI:'1',[name]:'external'})).toThrow('EXTERNAL_DATABASE_ENV_FORBIDDEN');
  expect(()=>pinAdminVisualCiEnvironment({CI:'true'})).toThrow('EPHEMERAL_CI_ONLY');
 });
 it('keeps inherited service secrets out of the runtime and prevents late dotenv R2 inheritance',()=>{
  const env:NodeJS.ProcessEnv={CI:'true',AYAHX_ADMIN_VISUAL_CI:'1',OPENAI_API_KEY:'external',COOKIE_DOMAIN:'production.invalid',R2_READ_ACCESS_KEY_ID:'external',R2_ENDPOINT:'https://external.invalid'};
  const runtime=pinAdminVisualCiEnvironment(env);
  expect(runtime.OPENAI_API_KEY).toBeUndefined();expect(runtime.COOKIE_DOMAIN).toBeUndefined();
  expect(env.R2_READ_ACCESS_KEY_ID).toBe('');expect(env.R2_ENDPOINT).toBe('');expect(env.DATABASE_URL).toBe('');
  expect(runtime.REDIS_URL).toBe('redis://127.0.0.1:6380/15');
 });
 it('defers the production runtime until after the global pins',()=>{
  const source=readFileSync('scripts/admin-visual-ci-server.ts','utf8');
  expect(source).not.toMatch(/import\s*\{createAdminRuntime\}\s*from/u);
  expect(source.indexOf('pinAdminVisualCiEnvironment(process.env)')).toBeLessThan(source.indexOf("await import('../server/admin/adminRuntime')"));
 });
});
