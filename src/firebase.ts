import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

// Direct integration of the user's provided Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyB_FDiwgopT4mL01bpPyoZBQFiE4m8-Qrs",
  authDomain: "myimages-27da2.firebaseapp.com",
  databaseURL: "https://myimages-27da2-default-rtdb.firebaseio.com",
  projectId: "myimages-27da2",
  storageBucket: "myimages-27da2.firebasestorage.app",
  messagingSenderId: "694681950812",
  appId: "1:694681950812:web:dad6d2c7ad879dd2f5e499",
  measurementId: "G-WJH0386G4X"
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const auth = getAuth(app);
export default app;
