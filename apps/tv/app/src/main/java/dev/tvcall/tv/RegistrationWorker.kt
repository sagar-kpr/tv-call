package dev.tvcall.tv

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

class RegistrationWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if(Backend.base(applicationContext).isBlank() || !Backend.isTvMode(applicationContext)) return Result.success()
        return try { Backend.register(applicationContext); Result.success() }
        catch (e: HttpFailure) {
            if (e.status == 403) { Backend.signOutRemoved(applicationContext); Result.success() } else Result.retry()
        } catch (_: Exception) { Result.retry() }
    }
    companion object {
        fun enqueue(c: Context) {
            if(Backend.base(c).isBlank() || !Backend.authorized(c)) return
            val request = OneTimeWorkRequestBuilder<RegistrationWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(c).enqueueUniqueWork("register-tv", ExistingWorkPolicy.REPLACE, request)
        }
        fun configurePeriodic(c: Context, enabled: Boolean) {
            val work = WorkManager.getInstance(c)
            if (!enabled) { work.cancelUniqueWork("reliable-register-tv"); return }
            val request = PeriodicWorkRequestBuilder<RegistrationWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            work.enqueueUniquePeriodicWork("reliable-register-tv", ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}
