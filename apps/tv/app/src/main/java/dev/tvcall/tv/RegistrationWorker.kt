package dev.tvcall.tv

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

class RegistrationWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if(Backend.base(applicationContext).isBlank()) return Result.success()
        return try { Backend.register(applicationContext); Result.success() } catch (_: Exception) { Result.retry() }
    }
    companion object {
        fun enqueue(c: Context) {
            if(Backend.base(c).isBlank()) return
            val request = OneTimeWorkRequestBuilder<RegistrationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(c).enqueueUniqueWork("register-tv", ExistingWorkPolicy.REPLACE, request)
        }
    }
}
