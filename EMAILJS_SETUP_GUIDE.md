# Guide de Configuration EmailJS pour GCBTP

## 📧 Configuration EmailJS

Pour que les formulaires envoient automatiquement les emails à **guindoconstruction@gmail.com**, vous devez configurer EmailJS.

### 🔧 Étapes de configuration

#### 1. **Créer un compte EmailJS**
1. Allez sur [https://www.emailjs.com/](https://www.emailjs.com/)
2. Cliquez sur "Sign Up" et créez un compte gratuit
3. Vérifiez votre email

#### 2. **Configurer un service email**
1. Dans le dashboard EmailJS, allez dans "Email Services"
2. Cliquez sur "Add New Service"
3. Choisissez "Gmail" (recommandé)
4. Connectez votre compte Gmail : **guindoconstruction@gmail.com**
5. Autorisez EmailJS à accéder à votre Gmail
6. Notez l'**ID du service** (ex: `service_xxxxxxx`)

#### 3. **Créer les templates d'email**

**Template 1 - Contact :**
- Nom : `template_contact`
- Sujet : `Nouvelle demande de contact - GCBTP`
- Contenu :
```
Nouvelle demande de contact reçue via le site GCBTP

INFORMATIONS CLIENT:
- Nom: {{from_name}}
- Email: {{from_email}}
- Téléphone: {{phone}}
- Entreprise: {{company}}

DÉTAILS DE LA DEMANDE:
- Service demandé: {{service}}
- Type de projet: {{project_type}}
- Budget estimé: {{budget}}

MESSAGE:
{{message}}

---
Message envoyé depuis le site GCBTP
```

**Template 2 - Devis :**
- Nom : `template_devis`
- Sujet : `Nouvelle demande de devis - GCBTP`
- Contenu :
```
Nouvelle demande de devis reçue via le site GCBTP

INFORMATIONS CLIENT:
- Nom: {{from_name}}
- Email: {{from_email}}
- Téléphone: {{phone}}
- Entreprise: {{company}}

DÉTAILS DU PROJET:
- Type de projet: {{project_type}}
- Description: {{description}}
- Budget estimé: {{budget}}

---
Message envoyé depuis le site GCBTP
```

**Template 3 - Candidature :**
- Nom : `template_candidature`
- Sujet : `Nouvelle candidature - GCBTP`
- Contenu :
```
Nouvelle candidature reçue via le site GCBTP

INFORMATIONS CANDIDAT:
- Nom: {{from_name}}
- Email: {{from_email}}
- Téléphone: {{phone}}
- Motivation: {{motivation}}

NOTE: Le CV est joint en pièce jointe (si disponible)

---
Message envoyé depuis le site GCBTP
```

#### 4. **Obtenir la clé publique**
1. Dans le dashboard EmailJS, allez dans "Account" > "General"
2. Copiez votre **Public Key** (ex: `user_xxxxxxxxxxxxx`)

#### 5. **Mettre à jour le code**

Remplacez `YOUR_PUBLIC_KEY` dans les fichiers HTML par votre vraie clé publique :

**Dans `index.html` et `contact.html` :**
```javascript
emailjs.init("user_xxxxxxxxxxxxx"); // Votre vraie clé publique
```

**Et remplacez `service_gcbtp` par votre ID de service :**
```javascript
emailjs.send('service_xxxxxxx', 'template_contact', {
    // ... données du formulaire
});
```

### 📋 Configuration finale

#### Fichiers à modifier :
1. **`index.html`** - Ligne 578 : `emailjs.init("VOTRE_CLE_PUBLIQUE")`
2. **`contact.html`** - Ligne 426 : `emailjs.init("VOTRE_CLE_PUBLIQUE")`
3. **`index.html`** - Lignes 612, 663 : `'service_xxxxxxx'`
4. **`contact.html`** - Ligne 458 : `'service_xxxxxxx'`

### 🧪 Test

1. **Déployez les modifications** sur GitHub Pages
2. **Testez chaque formulaire** sur votre site
3. **Vérifiez votre Gmail** : guindoconstruction@gmail.com
4. **Vérifiez les spams** si vous ne recevez pas les emails

### 💰 Coûts

- **Plan gratuit** : 200 emails/mois
- **Plan payant** : À partir de 15$/mois pour 1000 emails/mois

### 🔒 Sécurité

- La clé publique est visible côté client (c'est normal)
- EmailJS limite automatiquement les envois
- Vous pouvez configurer des domaines autorisés

### 🆘 Support

Si vous avez des problèmes :
1. Vérifiez la console du navigateur (F12) pour les erreurs
2. Vérifiez que votre service Gmail est bien connecté
3. Vérifiez que les templates existent
4. Contactez le support EmailJS si nécessaire

### 📞 Alternative rapide

Si EmailJS est trop complexe, vous pouvez aussi utiliser :
- **Netlify Forms** (si vous migrez vers Netlify)
- **Formspree** (service payant mais plus simple)
- **Web3Forms** (gratuit et simple)

---
**GCBTP** - Bureau d'Études Techniques
Email : guindoconstruction@gmail.com
