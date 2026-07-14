import mongoose from 'mongoose';

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tracefix';
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15_000,
  });
  const safe = uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
  console.log(`MongoDB connected: ${safe}`);
}

export { mongoose };
