# Free Images (Firebase)

Αυτό το project είναι **στατικό** (HTML/CSS/JS) και αποθηκεύει εικόνες σε:
- **Firebase Storage** (αρχεία εικόνων)
- **Cloud Firestore** (metadata + tags για αναζήτηση)

## 1) Setup στο Firebase Console
1. Create project
2. **Build → Firestore Database**: Create database (production ή test)
3. **Build → Storage**: Get started
4. **Build → Authentication**: Enable **Anonymous** sign-in

## 2) Βάλε το config
Άνοιξε το `firebase-config.js` και συμπλήρωσε το `firebaseConfig` από:
Project settings → Your apps → Web app.

## 3) (Προτεινόμενο) Security Rules
### Storage Rules
```txt
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{uid}/{fileName} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

### Firestore Rules
```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /images/{imageId} {
      allow read: if true;

      allow create: if request.auth != null
        && request.resource.data.ownerUid == request.auth.uid
        && (request.resource.data.license in ['CC0-1.0', 'PUBLIC-DOMAIN'])
        && request.resource.data.createdAt is int;

      allow update, delete: if request.auth != null
        && resource.data.ownerUid == request.auth.uid;
    }
  }
}
```

## 4) Τρέξιμο local
Τα ES modules χρειάζονται web server (όχι double-click).
- Python:
```bash
python -m http.server 8000
```
και άνοιξε `http://localhost:8000`

## 5) Hosting
Μπορείς να το ανεβάσεις σε Firebase Hosting / Netlify / Vercel κλπ.

## Σημειώσεις για Search
Το search χρησιμοποιεί `keywords` array και query `array-contains-any`.
Αν συνδυάσεις φίλτρα + orderBy, ίσως ζητήσει **composite index** (Firestore θα σου βγάλει link στο console).


## UI upgrades
- Theme toggle (dark/light)
- Sort (new/old)
- Skeleton loading + quick tags
