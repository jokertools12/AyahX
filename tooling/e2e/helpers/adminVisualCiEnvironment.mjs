import {randomBytes} from 'node:crypto';

/** Pin globals before importing production modules which read server/config. */
export function pinAdminVisualCiEnvironment(env) {
  if(env.CI!=='true'||env.AYAHX_ADMIN_VISUAL_CI!=='1')throw new Error('EPHEMERAL_CI_ONLY');
  if(env.DATABASE_URL||env.MYSQL_URL||env.RAILWAY_ENVIRONMENT_ID)throw new Error('EXTERNAL_DATABASE_ENV_FORBIDDEN');
  const pins={
    NODE_ENV:'test',PORT:'3005',CORS_ORIGIN:'http://127.0.0.1:3005',
    MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'33319',MYSQL_USER:'root',MYSQL_PASSWORD:'',
    MYSQL_DATABASE:'ayahx_ci_admin_visual',MYSQL_POOL_SIZE:'4',
    REDIS_URL:'redis://127.0.0.1:6380/15',RENDER_QUEUE_DRIVER:'database',
    // The authenticated media router and queue must share one disposable,
    // checkout-local boundary. Never inherit a developer or Railway path.
    RENDER_STORAGE_DIR:'uploads/renders',
    RENDER_BACKGROUND_MAINTENANCE:'false',STORAGE_VOLUME_BYTES:'5000000000',
    JWT_SECRET:randomBytes(32).toString('base64'),ADMIN_2FA_ENC_KEY:randomBytes(32).toString('base64'),
    // dotenv does not replace existing keys. External storage cannot be inherited.
    OBJECT_STORAGE_DRIVER:'local',OBJECT_STORAGE_BUCKET:'',OBJECT_STORAGE_ENDPOINT:'',
    OBJECT_STORAGE_ACCESS_KEY_ID:'',OBJECT_STORAGE_SECRET_ACCESS_KEY:'',OBJECT_STORAGE_PUBLIC_BASE_URL:'',
    DATABASE_URL:'',MYSQL_URL:'',RAILWAY_ENVIRONMENT_ID:'',
    R2_ACCOUNT_ID:'',R2_BUCKET:'',R2_ENDPOINT:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:'',
    R2_READ_ACCESS_KEY_ID:'',R2_READ_SECRET_ACCESS_KEY:'',R2_TOKEN_EXPIRES_AT:'',
  };
  Object.assign(env,pins);
  // Explicit runtime environment also excludes unrelated secrets/cookie domain
  // settings which dotenv may load later from the developer's local checkout.
  return {...pins};
}
