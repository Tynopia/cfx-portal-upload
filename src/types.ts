export interface ReUploadResponse {
  asset_id: number
  version_id: number
  errors: null
}

export interface Asset {
  id: number
  name: string
}

export interface AssetVersion {
  id: number
  version: string
  state: string
  created_at: string
  changelog: string
  is_release_candidate: boolean
}

export interface AssetDetail {
  id: number
  name: string
  state: string
  versions: AssetVersion[]
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
  COMPLETE_UPLOAD = 'assets/{id}/versions/{version_id}/complete-upload',
  ASSET_DETAIL = 'assets/{id}',
  DELETE_VERSION = 'assets/{id}/versions/{version_id}'
}
