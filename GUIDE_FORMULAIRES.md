# Guide des Formulaires GCBTP - Solution Mailto

## 📧 Comment fonctionnent les formulaires

Vos formulaires utilisent maintenant la solution **mailto** qui est simple, fiable et fonctionne sur tous les navigateurs.

### 🔄 Processus d'envoi

1. **Client remplit le formulaire** sur votre site
2. **Validation des champs** obligatoires
3. **Ouverture automatique** du client email par défaut
4. **Email pré-rempli** avec toutes les informations
5. **Client envoie** l'email à guindoconstruction@gmail.com

### 📋 Formulaires configurés

#### 1. **Formulaire de Contact** (`contact.html`)
- **Destination :** guindoconstruction@gmail.com
- **Sujet :** "Nouvelle demande de contact - GCBTP"
- **Contenu :** Nom, email, téléphone, entreprise, service, type de projet, budget, message

#### 2. **Formulaire de Devis** (`index.html`)
- **Destination :** guindoconstruction@gmail.com
- **Sujet :** "Nouvelle demande de devis - GCBTP"
- **Contenu :** Nom, email, téléphone, entreprise, type de projet, description, budget

#### 3. **Formulaire de Candidature** (`index.html`)
- **Destination :** guindoconstruction@gmail.com
- **Sujet :** "Nouvelle candidature - GCBTP"
- **Contenu :** Nom, email, téléphone, motivation, note sur le CV

### ✅ Avantages de cette solution

- **✅ Fonctionne immédiatement** - Pas de configuration complexe
- **✅ Compatible tous navigateurs** - Chrome, Firefox, Safari, Edge
- **✅ Pas de limite** - Aucune restriction sur le nombre d'envois
- **✅ Gratuit** - Aucun coût de service
- **✅ Sécurisé** - Pas de données stockées sur des serveurs tiers
- **✅ Fiable** - Utilise le client email natif de l'utilisateur

### 📱 Expérience utilisateur

1. **Client remplit le formulaire**
2. **Message de confirmation** : "Votre client email s'ouvre..."
3. **Client email s'ouvre automatiquement** avec le message pré-rempli
4. **Client clique sur "Envoyer"** pour finaliser
5. **Email reçu** à guindoconstruction@gmail.com

### 🔧 Configuration technique

- **Méthode :** mailto avec paramètres URL
- **Encodage :** UTF-8 pour les caractères spéciaux
- **Validation :** JavaScript côté client
- **Fallback :** Message d'erreur si problème

### 📧 Format des emails reçus

```
Sujet: Nouvelle demande de contact - GCBTP

Nouvelle demande de contact reçue via le site GCBTP

INFORMATIONS CLIENT:
- Nom: Jean Dupont
- Email: jean.dupont@email.com
- Téléphone: +221 77 123 45 67
- Entreprise: Société ABC

DÉTAILS DE LA DEMANDE:
- Service demandé: Structure du Bâtiment
- Type de projet: Résidentiel
- Budget estimé: 50 000 000 FCFA

MESSAGE:
Je souhaite construire une villa de 200m²...

---
Message envoyé depuis le site GCBTP
```

### 🚀 Déploiement

Les modifications sont prêtes. Pour déployer :

```bash
git add .
git commit -m "Fix: Configuration des formulaires avec solution mailto"
git push origin main
```

### 🧪 Test

1. Visitez votre site : https://giundo09.github.io/Guindo-construction/
2. Remplissez un formulaire
3. Vérifiez que votre client email s'ouvre
4. Envoyez le message de test
5. Vérifiez la réception à guindoconstruction@gmail.com

### 💡 Conseils d'utilisation

- **Pour les clients :** Expliquez qu'ils doivent cliquer sur "Envoyer" dans leur client email
- **Pour vous :** Vérifiez régulièrement guindoconstruction@gmail.com
- **Réponse :** Vous pouvez répondre directement aux clients depuis Gmail

### 🔄 Alternative future

Si vous souhaitez une solution plus avancée plus tard, vous pourrez facilement migrer vers :
- **Netlify Forms** (si vous migrez vers Netlify)
- **Formspree** (service payant)
- **EmailJS** (service gratuit avec limite)

---
**GCBTP** - Bureau d'Études Techniques
Email : guindoconstruction@gmail.com
