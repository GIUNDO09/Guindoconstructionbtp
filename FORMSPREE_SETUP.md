# Configuration Formspree pour GCBTP

## 📧 Configuration des formulaires

Vos formulaires sont maintenant configurés pour envoyer automatiquement les données à **guindoconstruction@gmail.com**.

### 🔧 Service utilisé : Formspree

**URL du formulaire :** `https://formspree.io/f/xpzqkqkj`

### 📋 Formulaires configurés

1. **Formulaire de Contact** (`contact.html`)
   - Sujet : "Nouvelle demande de contact - GCBTP"
   - Email de destination : guindoconstruction@gmail.com
   - Champs : Prénom, Nom, Email, Téléphone, Entreprise, Service, Type de projet, Budget, Message

2. **Formulaire de Devis** (`index.html`)
   - Sujet : "Nouvelle demande de devis - GCBTP"
   - Email de destination : guindoconstruction@gmail.com
   - Champs : Nom, Email, Téléphone, Entreprise, Type de projet, Description, Budget

3. **Formulaire de Candidature** (`index.html`)
   - Sujet : "Nouvelle candidature - GCBTP"
   - Email de destination : guindoconstruction@gmail.com
   - Champs : Nom, Email, Téléphone, Motivation, CV (fichier)

### ⚙️ Configuration technique

- **Méthode :** POST
- **Service :** Formspree (gratuit jusqu'à 50 soumissions/mois)
- **Validation :** JavaScript côté client
- **Réponse :** Messages de confirmation automatiques

### 📨 Ce que vous recevrez par email

Chaque soumission de formulaire vous enverra un email contenant :
- Toutes les informations saisies par le client
- L'email du client pour pouvoir répondre directement
- L'heure et la date de la soumission
- Le type de formulaire (contact, devis, ou candidature)

### 🔄 Réponse automatique

Les clients recevront automatiquement :
- Un message de confirmation de réception
- L'assurance que vous les contacterez rapidement

### 🚀 Déploiement

Les modifications sont prêtes à être déployées. Exécutez :

```bash
git add .
git commit -m "Add: Configuration des formulaires avec envoi automatique vers guindoconstruction@gmail.com"
git push origin main
```

### 📞 Support Formspree

Si vous avez besoin d'augmenter la limite de soumissions ou d'ajouter des fonctionnalités :
- Site : https://formspree.io
- Plan gratuit : 50 soumissions/mois
- Plan payant : À partir de 10$/mois pour 1000 soumissions

### ✅ Test recommandé

Après déploiement, testez chaque formulaire pour vérifier que les emails arrivent bien à guindoconstruction@gmail.com.

---
**GCBTP** - Bureau d'Études Techniques
Email : guindoconstruction@gmail.com
