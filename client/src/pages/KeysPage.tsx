import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'
import type { ApiKey, CreateGatewayApiKeyResponse, GatewayApiKey, Platform } from '../../../shared/types'
import { Check, Copy, ExternalLink, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import { formatSqliteUtcToLocalTime } from '@/lib/utils'

// Small "Get API key" external link shown next to a provider (#137).
function GetKeyLink({ url }: { url: string }) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      Get API key
      <ExternalLink className="size-3" />
    </a>
  )
}

// `url` points to each provider's key-management / signup page so the Keys page
// can show a "Get API key" shortcut (#137). OpenCode Zen's key is free from
// opencode.ai/auth — no card needed; billing only applies to paid models (#128).
// `keyless: true` providers (Kilo's anonymous free tier) need no API key — the
// form disables the key field and submits a sentinel the backend stores so
// routing treats the platform as configured.
const PLATFORMS: { value: Platform; label: string; url: string; keyless?: boolean }[] = [
  { value: 'google', label: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' },
  { value: 'groq', label: 'Groq', url: 'https://console.groq.com/keys' },
  { value: 'cerebras', label: 'Cerebras', url: 'https://cloud.cerebras.ai' },
  { value: 'sambanova', label: 'SambaNova', url: 'https://cloud.sambanova.ai' },
  { value: 'nvidia', label: 'NVIDIA NIM', url: 'https://build.nvidia.com/settings/api-keys' },
  { value: 'mistral', label: 'Mistral', url: 'https://console.mistral.ai/api-keys/' },
  { value: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/keys' },
  { value: 'github', label: 'GitHub Models', url: 'https://github.com/settings/tokens' },
  { value: 'cohere', label: 'Cohere', url: 'https://dashboard.cohere.com/api-keys' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI', url: 'https://dash.cloudflare.com' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)', url: 'https://z.ai/manage-apikey/apikey-list' },
  { value: 'ollama', label: 'Ollama Cloud', url: 'https://ollama.com/settings/keys' },
  { value: 'kilo', label: 'Kilo Gateway (no key needed)', url: 'https://app.kilo.ai', keyless: true },
  { value: 'pollinations', label: 'Pollinations (anon ok)', url: 'https://pollinations.ai' },
  { value: 'llm7', label: 'LLM7 (anon ok)', url: 'https://llm7.io' },
  { value: 'huggingface', label: 'HuggingFace Router', url: 'https://huggingface.co/settings/tokens' },
  { value: 'opencode', label: 'OpenCode Zen (free key)', url: 'https://opencode.ai/auth' },
]

// 'custom' is configured through its own form (base URL + model), not the
// generic key dropdown — but it still appears in the grouped provider list.
const CUSTOM_GROUP: { value: Platform; label: string; url: string } = {
  value: 'custom',
  label: 'Custom (OpenAI-compatible)',
  url: '',
}

const PLAYGROUND_GATEWAY_KEY_STORAGE = 'freellmapi_playground_gateway_key'

const statusDot: Record<string, string> = {
  healthy: 'bg-emerald-500',
  rate_limited: 'bg-amber-500',
  invalid: 'bg-rose-500',
  error: 'bg-rose-500',
  unknown: 'bg-muted-foreground/40',
}

const statusLabel: Record<string, string> = {
  healthy: 'healthy',
  rate_limited: 'rate-limited',
  invalid: 'invalid',
  error: 'error',
  unknown: 'unchecked',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

function UnifiedKeySection() {
  const queryClient = useQueryClient()
  const [label, setLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<CreateGatewayApiKeyResponse | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'regenerate'; id: number } | null>(null)

  const { data: gatewayKeys = [], isLoading, isError } = useQuery<GatewayApiKey[]>({
    queryKey: ['gateway-keys'],
    queryFn: () => apiFetch('/api/gateway-keys'),
  })

  const createKey = useMutation({
    mutationFn: (body: { label?: string }) =>
      apiFetch<CreateGatewayApiKeyResponse>('/api/gateway-keys', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (key) => {
      setCreatedKey(key)
      setLabel('')
      sessionStorage.setItem(PLAYGROUND_GATEWAY_KEY_STORAGE, key.key)
      queryClient.invalidateQueries({ queryKey: ['gateway-keys'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-gateway-keys'] })
    },
  })

  const updateGatewayKey = useMutation({
    mutationFn: ({ id, ...body }: { id: number; label?: string; enabled?: boolean }) =>
      apiFetch<GatewayApiKey>(`/api/gateway-keys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditingId(null)
      setEditingLabel('')
      queryClient.invalidateQueries({ queryKey: ['gateway-keys'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-gateway-keys'] })
    },
  })

  const deleteGatewayKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/gateway-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmAction(null)
      queryClient.invalidateQueries({ queryKey: ['gateway-keys'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-gateway-keys'] })
    },
  })

  const regenerateGatewayKey = useMutation({
    mutationFn: (id: number) =>
      apiFetch<CreateGatewayApiKeyResponse>(`/api/gateway-keys/${id}/regenerate`, { method: 'POST' }),
    onSuccess: (key) => {
      setCreatedKey(key)
      setConfirmAction(null)
      sessionStorage.setItem(PLAYGROUND_GATEWAY_KEY_STORAGE, key.key)
      queryClient.invalidateQueries({ queryKey: ['gateway-keys'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-gateway-keys'] })
    },
  })

  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:${__SERVER_PORT__}/v1`
    : `${window.location.origin}/v1`
  const activeGatewayKeyCount = gatewayKeys.filter(key => key.enabled).length

  function copyRawGatewayKey(key: CreateGatewayApiKeyResponse) {
    navigator.clipboard.writeText(key.key)
    setCopiedId(key.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function submitGatewayKey(event: React.FormEvent) {
    event.preventDefault()
    createKey.mutate({ label: label.trim() || undefined })
  }

  function startGatewayKeyEditing(key: GatewayApiKey) {
    setEditingId(key.id)
    setEditingLabel(key.label)
  }

  function saveGatewayKeyLabel(id: number) {
    updateGatewayKey.mutate({ id, label: editingLabel })
  }

  return (
    <section>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-medium">Gateway API keys</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Keys your apps use to call this gateway. Provider keys below are only for upstream LLM providers.
          </p>
        </div>
      </div>

      {isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          Can't reach the server on <code className="font-mono">{baseUrl.replace('/v1', '')}</code>. Make sure the
          backend is running — <code className="font-mono">npm run dev</code> starts both, and the server logs print
          under the <code className="font-mono">server</code> prefix.
        </div>
      ) : (
        <>
          <form onSubmit={submitGatewayKey} className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
            <div className="space-y-1.5 flex-1 min-w-[220px]">
              <Label className="text-xs">Label</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="optional, e.g. mobile app"
                maxLength={120}
              />
            </div>
            <Button type="submit" size="sm" disabled={createKey.isPending}>
              {createKey.isPending ? 'Creating…' : 'Create gateway key'}
            </Button>
          </form>

          {createdKey && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Copy this key now. It will not be shown again.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Use it as your OpenAI-compatible <code className="font-mono">api_key</code>.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => copyRawGatewayKey(createdKey)}>
                  <Copy className="size-3.5" />
                  {copiedId === createdKey.id ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <code className="block rounded-md bg-background px-3 py-2 text-xs font-mono tabular-nums break-all">
                {createdKey.key}
              </code>
            </div>
          )}

          <div className="rounded-lg border bg-card overflow-hidden">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : gatewayKeys.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No gateway keys yet. Create one to let clients call this gateway.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Label</TableHead>
                    <TableHead>Key preview</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gatewayKeys.map(key => {
                    const isEditingGatewayKey = editingId === key.id
                    const isConfirmingDelete = confirmAction?.type === 'delete' && confirmAction.id === key.id
                    const isConfirmingRegenerate = confirmAction?.type === 'regenerate' && confirmAction.id === key.id
                    const isLastActive = key.enabled && activeGatewayKeyCount <= 1
                    return (
                      <TableRow key={key.id}>
                        <TableCell className="pl-4">
                          {isEditingGatewayKey ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editingLabel}
                                onChange={e => setEditingLabel(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveGatewayKeyLabel(key.id)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                className="h-7 w-[180px] text-xs"
                                maxLength={120}
                                autoFocus
                              />
                              <Button variant="ghost" size="icon-xs" onClick={() => saveGatewayKeyLabel(key.id)} disabled={updateGatewayKey.isPending}>
                                <Check />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={() => setEditingId(null)}>
                                <X />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm">{key.label || 'Untitled'}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-xs tabular-nums">{key.keyPreview}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant={key.enabled ? 'secondary' : 'outline'}>
                            {key.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {formatSqliteUtcToLocalTime(key.createdAt, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {formatSqliteUtcToLocalTime(key.lastUsedAt, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end gap-1">
                            <Switch
                              checked={key.enabled}
                              disabled={updateGatewayKey.isPending || isLastActive}
                              onCheckedChange={(enabled) => updateGatewayKey.mutate({ id: key.id, enabled })}
                            />
                            {!isEditingGatewayKey && (
                              <Button variant="ghost" size="icon-xs" onClick={() => startGatewayKeyEditing(key)}>
                                <Pencil />
                              </Button>
                            )}
                            {isConfirmingRegenerate ? (
                              <>
                                <Button variant="destructive" size="xs" onClick={() => regenerateGatewayKey.mutate(key.id)} disabled={regenerateGatewayKey.isPending}>
                                  Confirm
                                </Button>
                                <Button variant="ghost" size="icon-xs" onClick={() => setConfirmAction(null)}>
                                  <X />
                                </Button>
                              </>
                            ) : (
                              <Button variant="ghost" size="icon-xs" onClick={() => setConfirmAction({ type: 'regenerate', id: key.id })}>
                                <RefreshCw />
                              </Button>
                            )}
                            {isConfirmingDelete ? (
                              <>
                                <Button variant="destructive" size="xs" onClick={() => deleteGatewayKey.mutate(key.id)} disabled={deleteGatewayKey.isPending || isLastActive}>
                                  Revoke
                                </Button>
                                <Button variant="ghost" size="icon-xs" onClick={() => setConfirmAction(null)}>
                                  <X />
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-muted-foreground hover:text-destructive"
                                disabled={isLastActive}
                                onClick={() => setConfirmAction({ type: 'delete', id: key.id })}
                              >
                                <Trash2 />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Base URL</span>
        <code className="font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">Endpoint</span>
        <code className="font-mono">/v1/chat/completions</code>
      </div>
    </section>
  )
}

function CustomProviderSection() {
  const queryClient = useQueryClient()
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')

  const addCustom = useMutation({
    mutationFn: (body: { baseUrl: string; model: string; displayName?: string; apiKey?: string }) =>
      apiFetch('/api/keys/custom', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
      setModel('')
      setDisplayName('')
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!baseUrl || !model) return
    addCustom.mutate({ baseUrl, model, displayName: displayName || undefined, apiKey: apiKey || undefined })
  }

  return (
    <section>
      <h2 className="text-sm font-medium mb-1">Add a custom OpenAI-compatible model</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Point at any OpenAI-compatible endpoint — llama.cpp, LM Studio, vLLM, a local Ollama, or a remote
        gateway. Add each model you want routed; they all share the one endpoint. The API key is optional
        (most local servers don't need one).
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card">
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <Label className="text-xs">Base URL</Label>
          <Input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:11434/v1"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          <Input
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="qwen3:4b"
            className="w-[180px] font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Display name</Label>
          <Input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="optional"
            className="w-[150px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">API key</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="optional"
            className="w-[150px] font-mono text-xs"
          />
        </div>
        <Button type="submit" size="sm" disabled={!baseUrl || !model || addCustom.isPending}>
          {addCustom.isPending ? 'Adding…' : 'Add model'}
        </Button>
      </form>
      {addCustom.isError && (
        <p className="text-destructive text-xs mt-2">{(addCustom.error as Error).message}</p>
      )}
    </section>
  )
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  const togglePlatform = useMutation({
    mutationFn: ({ platform, enabled }: { platform: string; enabled: boolean }) =>
      apiFetch(`/api/keys/platform/${platform}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
    },
  })

  const updateKey = useMutation({
    mutationFn: ({ id, label }: { id: number; label: string }) =>
      apiFetch(`/api/keys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      setEditingKeyId(null)
      setEditingLabel('')
    },
  })

  function startEditing(key: ApiKey) {
    setEditingKeyId(key.id)
    setEditingLabel(key.label)
  }

  function cancelEditing() {
    setEditingKeyId(null)
    setEditingLabel('')
  }

  function saveEditing(id: number) {
    if (editingLabel !== undefined) {
      updateKey.mutate({ id, label: editingLabel })
    }
  }

  useEffect(() => {
    if (editingKeyId !== null && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingKeyId])

  const needsAccountId = platform === 'cloudflare'
  const isKeyless = PLATFORMS.find(p => p.value === platform)?.keyless ?? false

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform) return
    if (!isKeyless && !apiKey) return
    if (needsAccountId && !accountId) return
    // Keyless providers submit an empty key; the backend stores a sentinel.
    const key = isKeyless ? '' : (needsAccountId ? `${accountId}:${apiKey}` : apiKey)
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = [...PLATFORMS, CUSTOM_GROUP].map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  })).filter(p => p.keys.length > 0)

  return (
    <div>
      <PageHeader
        title="Keys"
        description="Gateway client keys and upstream provider credentials."
        actions={
          keys.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending}>
              {checkAll.isPending ? 'Checking…' : 'Check all'}
            </Button>
          )
        }
      />

      <div className="space-y-8">
        <UnifiedKeySection />

        <section>
          <h2 className="text-sm font-medium mb-3">Add a provider key</h2>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4 bg-card">
            <div className="space-y-1.5">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(() => {
                const sel = PLATFORMS.find(p => p.value === platform)
                return sel?.url ? <div className="pt-0.5"><GetKeyLink url={sel.url} /></div> : null
              })()}
            </div>
            {needsAccountId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Account ID</Label>
                <Input
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="a1b2c3d4…"
                  className="w-[200px] font-mono text-xs"
                />
              </div>
            )}
            <div className="space-y-1.5 flex-1 min-w-[240px]">
              <Label className="text-xs">{needsAccountId ? 'API token' : 'API key'}</Label>
              <Input
                type="password"
                value={isKeyless ? '' : apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={isKeyless ? 'No API key needed' : (needsAccountId ? 'Bearer token' : 'paste key here')}
                className="font-mono text-xs"
                disabled={isKeyless}
              />
              {isKeyless && (
                <p className="text-[11px] text-muted-foreground">
                  No API key needed — this provider's free tier is anonymous (rate-limited per IP).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Label</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="optional"
                className="w-[160px]"
              />
            </div>
            <Button type="submit" size="sm" disabled={!platform || (!isKeyless && !apiKey) || (needsAccountId && !accountId) || addKey.isPending}>
              {addKey.isPending ? 'Adding…' : isKeyless ? 'Enable' : 'Add key'}
            </Button>
          </form>
          {addKey.isError && (
            <p className="text-destructive text-xs mt-2">{(addKey.error as Error).message}</p>
          )}
        </section>

        <CustomProviderSection />

        <section>
          <h2 className="text-sm font-medium mb-3">Configured providers</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No provider keys yet. Add one above to start routing.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(group => (
                <div key={group.value}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={group.keys.some(k => k.enabled)}
                        onCheckedChange={(checked) =>
                          togglePlatform.mutate({ platform: group.value, enabled: checked })
                        }
                        disabled={togglePlatform.isPending}
                      />
                      <h3 className="text-sm font-medium">{group.label}</h3>
                      <GetKeyLink url={group.url} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {group.keys.length} key{group.keys.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="rounded-lg border divide-y bg-card overflow-hidden">
                    {group.keys.map(k => {
                      const h = healthKeyMap.get(k.id)
                      const status = h?.status ?? k.status
                      const lastChecked = h?.lastCheckedAt
                      const isEditing = editingKeyId === k.id
                      return (
                        <div key={k.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                          <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
                          <code className="text-xs font-mono flex-shrink-0">{k.maskedKey}</code>
                          {isEditing ? (
                            <Input
                              ref={editInputRef}
                              value={editingLabel}
                              onChange={e => setEditingLabel(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveEditing(k.id)
                                if (e.key === 'Escape') cancelEditing()
                              }}
                              onBlur={() => saveEditing(k.id)}
                              className="h-6 w-[160px] text-xs"
                              disabled={updateKey.isPending}
                            />
                          ) : (
                            <>
                              {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
                            </>
                          )}
                          <span className="text-xs text-muted-foreground">{statusLabel[status] ?? status}</span>
                          <div className="flex-1" />
                          {lastChecked && (
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {formatSqliteUtcToLocalTime(lastChecked, { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {!isEditing && (
                            <Button variant="ghost" size="xs" onClick={() => startEditing(k)}>
                              <Pencil className="size-3" />
                            </Button>
                          )}
                          <Button variant="ghost" size="xs" onClick={() => checkKey.mutate(k.id)} disabled={checkKey.isPending}>
                            Check
                          </Button>
                          <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>
                            Remove
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
