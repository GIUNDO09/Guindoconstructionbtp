# 🔍 Diagnostic Zoho Mail - GCBTP

## ❌ Problème actuel

Vous ne recevez pas d'emails sur `contact@guindoconstruction.xyz` malgré la configuration Zoho.

## 🔎 Étapes de diagnostic

### Étape 1 : Vérifier les enregistrements MX

Les enregistrements MX (Mail Exchange) dirigent les emails vers Zoho.

**Test en ligne :**
1. Allez sur [mxtoolbox.com](https://mxtoolbox.com/)
2. Entrez `guindoconstruction.xyz` dans "MX Lookup"
3. Cliquez sur "MX Lookup"

**Résultat attendu :**
```
mx.zoho.com (priorité 10)
mx2.zoho.com (priorité 20)
```

**Si vous ne voyez pas ces résultats :**
- Les enregistrements MX ne sont pas configurés correctement
- Voir section "Configuration DNS" ci-dessous

### Étape 2 : Vérifier dans Zoho Mail Admin

1. Connectez-vous à [mailadmin.zoho.com](https://mailadmin.zoho.com/)
2. Allez dans **Domains** → `guindoconstruction.xyz`
3. Vérifiez le statut :
   - ✅ **Vérifié** = Bon
   - ❌ **Non vérifié** = Problème

**Si non vérifié :**
- Cliquez sur "Vérifier le domaine"
- Suivez les instructions pour ajouter les enregistrements DNS requis

### Étape 3 : Vérifier que le compte email existe

1. Dans Zoho Mail Admin → **Users**
2. Vérifiez que `contact@guindoconstruction.xyz` existe
3. Si non, créez-le :
   - Cliquez sur "Add User"
   - Email : `contact`
   - Domaine : `guindoconstruction.xyz`
   - Mot de passe : (choisissez un mot de passe sécurisé)

### Étape 4 : Vérifier les filtres anti-spam

1. Connectez-vous à [mail.zoho.com](https://mail.zoho.com/) avec `contact@guindoconstruction.xyz`
2. Allez dans **Paramètres** → **Filtres**
3. Vérifiez qu'aucun filtre ne bloque les emails entrants

### Étape 5 : Tester l'envoi d'email

**Option A : Test depuis Gmail**
1. Envoyez un email depuis votre Gmail vers `contact@guindoconstruction.xyz`
2. Attendez 5-10 minutes
3. Vérifiez la boîte Zoho Mail

**Option B : Test depuis le site**
1. Utilisez le fichier `test-zoho-email.html`
2. Ouvrez-le dans votre navigateur
3. Envoyez un email de test
4. Vérifiez la réception dans Zoho

## 🔧 Configuration DNS requise

### Où configurer ?

**Important :** Configurez les DNS chez votre **registrar de domaine** (là où vous avez acheté `guindoconstruction.xyz`), **PAS dans Vercel**.

### Enregistrements à ajouter

#### 1. Enregistrements MX (OBLIGATOIRE)

```
Type: MX
Nom: @
Priorité: 10
Valeur: mx.zoho.com
```

```
Type: MX
Nom: @
Priorité: 20
Valeur: mx2.zoho.com
```

#### 2. Enregistrement SPF (Recommandé - Anti-spam)

```
Type: TXT
Nom: @
Valeur: v=spf1 include:zoho.com ~all
```

#### 3. Enregistrements DKIM (Recommandé - Authentification)

1. Dans Zoho Mail Admin → **Domains** → `guindoconstruction.xyz` → **DKIM**
2. Copiez les enregistrements DKIM fournis
3. Ajoutez-les dans votre DNS (Type: TXT)

#### 4. Enregistrements pour Vercel (Site Web)

Ces enregistrements permettent à votre site de fonctionner :

```
Type: A
Nom: @
Valeur: 76.76.21.21
```

OU (selon ce que Vercel recommande)

```
Type: CNAME
Nom: @
Valeur: cname.vercel-dns.com
```

**Note :** Vercel vous donne les valeurs exactes dans :
- Vercel Dashboard → Votre Projet → Settings → Domains

## ⚠️ Problèmes courants

### Problème 1 : Conflit DNS Vercel vs Zoho

**Symptôme :** Le site fonctionne mais les emails n'arrivent pas.

**Cause :** Si vous utilisez les DNS de Vercel, vous ne pouvez pas configurer les MX pour Zoho.

**Solution :**
1. Utilisez les DNS de votre registrar (pas ceux de Vercel)
2. Configurez les enregistrements A/CNAME pour Vercel
3. Configurez les enregistrements MX pour Zoho

### Problème 2 : Propagation DNS incomplète

**Symptôme :** Configuration correcte mais emails toujours non reçus.

**Cause :** Les changements DNS peuvent prendre 24-48h pour se propager.

**Solution :**
- Attendez 24-48h après la configuration
- Vérifiez avec mxtoolbox.com que les MX sont actifs

### Problème 3 : Emails dans les spams

**Symptôme :** Les emails arrivent mais dans le dossier spam.

**Solution :**
1. Marquez l'email comme "Non spam" dans Zoho
2. Ajoutez l'expéditeur à vos contacts
3. Vérifiez que SPF et DKIM sont configurés

### Problème 4 : Web3Forms ne fonctionne pas

**Symptôme :** Les formulaires du site n'envoient pas d'emails.

**Vérifications :**
1. La clé Web3Forms est correcte : `cf53af9f-c13b-4a19-bfd0-69c85ee9f19d`
2. L'adresse de destination est correcte : `contact@guindoconstruction.xyz`
3. Les enregistrements MX sont configurés

**Test :**
- Utilisez `test-zoho-email.html` pour tester
- Vérifiez la console du navigateur pour les erreurs

## 📋 Checklist de vérification

- [ ] Enregistrements MX configurés (mx.zoho.com, mx2.zoho.com)
- [ ] Enregistrement SPF configuré (v=spf1 include:zoho.com ~all)
- [ ] Enregistrements DKIM configurés (depuis Zoho Admin)
- [ ] Domaine vérifié dans Zoho Mail Admin
- [ ] Compte `contact@guindoconstruction.xyz` créé dans Zoho
- [ ] Test d'envoi depuis Gmail réussi
- [ ] Test d'envoi depuis le site réussi
- [ ] Aucun filtre anti-spam bloquant les emails

## 🧪 Tests à effectuer

### Test 1 : Vérification MX
```bash
# Dans PowerShell
nslookup -type=MX guindoconstruction.xyz
```

OU utilisez [mxtoolbox.com](https://mxtoolbox.com/)

### Test 2 : Envoi depuis Gmail
1. Envoyez un email depuis Gmail
2. Vérifiez la réception dans Zoho

### Test 3 : Envoi depuis le site
1. Ouvrez `test-zoho-email.html`
2. Envoyez un email de test
3. Vérifiez la réception

## 📞 Support

**Si le problème persiste après ces vérifications :**

1. **Support Zoho :**
   - [support.zoho.com](https://support.zoho.com/)
   - Email : support@zoho.com

2. **Informations à fournir :**
   - Votre domaine : `guindoconstruction.xyz`
   - Votre registrar de domaine
   - Capture d'écran des enregistrements DNS
   - Capture d'écran du statut dans Zoho Mail Admin
   - Résultat de mxtoolbox.com pour les MX

3. **Logs Zoho :**
   - Zoho Mail Admin → Logs → Email Logs
   - Vérifiez s'il y a des erreurs

---

**Dernière mise à jour :** 2025-01-27





