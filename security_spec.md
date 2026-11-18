# Especificação de Segurança — SISCOM Firestore

## 1. Invariantes de Dados
1. Nenhum documento em `/admins/{userId}` ou `/users/{userId}` pode ser lido ou alterado sem autenticação (`request.auth != null`).
2. Apenas o administrador inicial verificado (`mayconpaulo6000@gmail.com` com `email_verified == true`) ou um administrador registrado em `/admins/{uid}` pode criar, atualizar ou remover contas em `/users` e `/admins`.
3. Usuários comuns (`role: 'user'`) só podem ler (`get`) o próprio documento `/users/{request.auth.uid}` e alterar exclusivamente as flags de onboarding (`mustChangePassword`, `securityQuestionSetup`, `updatedAt`) no próprio perfil ativo; nunca `role`, `active` ou permissões (`permPrismas`, `permCrachas`, `permAlteracao`, `permDocumentos`, `permCartoes`).
4. As coleções `/recovery/{username}` e `/auth_lookup/{username}` nunca permitem listagem (`allow list: if false`), armazenam zero PII e permitem `get` apenas por ID exato de `username` válido antes do login; criação/atualização exigem `request.auth != null` com validação estrita de identidade e esquema.
5. Todos os campos `createdAt` e `updatedAt` exigem `request.time` (carimbo do servidor).
6. `uid`, `createdBy` e `createdAt` são imutáveis após criação; todas as strings e listas possuem limites explícitos de tamanho e validação de formato.

## 2. "Dirty Dozen" — Payloads Maliciosos Testados
1. **Unauthenticated User Read**: `get(/users/uid1)` sem `request.auth` -> `PERMISSION_DENIED`.
2. **Email Spoof Admin**: `request.auth.token.email == 'mayconpaulo6000@gmail.com'` com `email_verified: false` tentando escrever em `/admins/uid2` -> `PERMISSION_DENIED`.
3. **Self-Privilege Escalation**: Usuário comum tentando criar `/admins/{seuUid}` -> `PERMISSION_DENIED`.
4. **User Role Escalation on Update**: Usuário comum tentando atualizar `/users/{seuUid}` com `role: 'admin'` ou `permAlteracao: true` -> `PERMISSION_DENIED`.
5. **Cross-User PII Read**: Usuário comum `uidA` tentando ler `/users/uidB` -> `PERMISSION_DENIED`.
6. **Shadow Field Injection**: Admin enviando campo extra não previsto `{ ..., isSuperUser: true }` -> `PERMISSION_DENIED`.
7. **Oversized ID Poisoning**: ID de documento com > 128 caracteres ou caracteres inválidos (`a/b`) -> `PERMISSION_DENIED`.
8. **Type Poisoning**: `permPrismas: "true"` ou `mustChangePassword: "false"` -> `PERMISSION_DENIED`.
9. **Immutable Field Tampering**: Tentativa de alterar `createdBy` ou `createdAt` durante `update` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: `updatedAt` diferente de `request.time` -> `PERMISSION_DENIED`.
11. **Recovery List Scraping**: Tentativa de `list(/recovery)` para enumerar usuários -> `PERMISSION_DENIED`.
12. **Cross-User Recovery Hijack**: Usuário `uidA` tentando sobrescrever `/recovery/usuarioB` ou alterar `uid` de outro usuário -> `PERMISSION_DENIED`.
