export interface ReUploadResponse {
  asset_id: number
  version_id: number
  errors: null
}

export interface Asset {
  id: number
  name: string
}

export interface SearchResponse {
  items: Asset[]
}

export interface SSOResponseBody {
  url: string
}

export enum Urls {
  API = 'https://portal-api.cfx.re/v1/',
  SSO = 'auth/discourse?return=',
  REUPLOAD = 'assets/{id}/re-upload',
  UPLOAD_CHUNK = 'assets/{id}/versions/{version_id}/upload-chunk',
  COMPLETE_UPLOAD = 'assets/{id}/versions/{version_id}/complete-upload'
}
