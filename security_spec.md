# Especificação de Segurança — SISCOM Firestore

## 1. Invariantes de Dados
1. Nenhum documento em `/admins/{userId}` ou `/users/{userId}` pode ser lido ou alterado sem autenticação (`request.auth != null`).
2. Apenas o administrador inicial verificado (`mayconpaulo6000@gmail.com` com `email_verified == true`) ou um administrador registrado em `/admins/{uid}` pode criar, atualizar ou remover contas em `/users` e `/admins`.
3. Usuários comuns (`role: 'user'`) só podem ler (`get`) o próprio documento `/users/{request.auth.uid}` e alterar exclusivamente as flags de onboarding (`mustChangePassword`, `securityQuestionSetup`, `updatedAt`) no próprio perfil ativo; nunca `role`, `active` ou permissões (`permPrismas`, `permCrachas`, `permAlteracao`, `permDocumentos`, `permCartoes`, `permRelatorio`).
4. As coleções `/recovery/{username}` e `/auth_lookup/{username}` nunca permitem listagem (`allow list: if false`), armazenam zero PII e permitem `get` apenas por ID exato de `username` válido antes do login; criação/atualização exigem `request.auth != null` com validação estrita de identidade e esquema.
5. Todos os campos `createdAt` e `updatedAt` exigem `request.time` (carimbo do servidor).
6. `uid`, `createdBy` e `createdAt` são imutáveis após criação; todas as strings e listas possuem limites explícitos de tamanho e validação de formato.
7. Administradores desativados (`active == false`) perdem imediatamente o status de `isAdmin()`, e administradores secundários só gerenciam contas vinculadas à própria cadeia (`adminUids`/`createdBy`), sem acesso para alterar ou excluir o administrador principal (`admin-google`) ou administradores não vinculados.
8. As subcoleções pessoais `/users/{userId}/alteracao_folders/{folderId}` e `/users/{userId}/alteracao_docs/{docId}` são estritamente privadas ao próprio titular autenticado e ativo com acesso ao módulo Alteração (`isOwner(userId)`), com `ownerUid` imutável, carimbos `request.time`, limites de tamanho em strings/listas e bloqueio de auto-parentesco em pastas (`parentId != folderId`).
9. As coleções `/agenda_events/{eventId}`, `/agenda_audit/{logId}` e `/agenda_config/google_calendar` exigem usuário autenticado, ativo e com acesso ao módulo Agenda (`role == 'admin'` ou `permAgenda == true`), validação estrita de esquema e limites de tamanho, imutabilidade de autoria/criação, registros de auditoria somente-leitura após criação e proibição absoluta de armazenar tokens OAuth no Firestore.

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
13. **Deactivated Admin Lockout**: Administrador secundário com `users/{uid}.active == false` tentando alterar ou excluir contas -> `PERMISSION_DENIED`.
14. **Peer/Root Admin Protection**: Administrador secundário tentando modificar `admin-google` ou remover administrador não vinculado -> `PERMISSION_DENIED`.
15. **Cross-User Alteracao Archive Read/Write**: Usuário `uidA` tentando ler, listar ou criar em `/users/uidB/alteracao_folders` ou `/users/uidB/alteracao_docs` -> `PERMISSION_DENIED`.
16. **Folder Self-Parent Cycle Injection**: Usuário tentando criar/atualizar pasta com `parentId == folderId` -> `PERMISSION_DENIED`.
17. **Alteracao Doc Owner Tampering / Oversized Payload**: Tentativa de alterar `ownerUid` em update ou enviar `pagesHtml` vazio / > 60 itens / campos extras -> `PERMISSION_DENIED`.
18. **Unauthorized Module Archive Write**: Usuário sem `permAlteracao == true` (e não admin) tentando criar pasta ou arquivar alteração -> `PERMISSION_DENIED`.
19. **Unauthorized Agenda Write**: Usuário sem `permAgenda == true` (e não admin) tentando criar, atualizar ou excluir em `/agenda_events` -> `PERMISSION_DENIED`.
20. **Agenda Audit Tampering**: Tentativa de editar ou excluir documento existente em `/agenda_audit/{logId}` -> `PERMISSION_DENIED`.
21. **Agenda Token Injection in Config**: Tentativa de gravar `accessToken` ou campo extra em `/agenda_config/google_calendar` -> `PERMISSION_DENIED`.
22. **Agenda Spoofed Creator**: Usuário tentando criar evento em `/agenda_events` com `createdByUid != request.auth.uid` -> `PERMISSION_DENIED`.

