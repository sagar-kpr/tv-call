package dev.tvcall.tv

/** Restore only our own boost; preserve any volume change the user makes while ringing. */
internal class RingVolume(private val original: Int, maximum: Int) {
    val raised = maxOf(original, kotlin.math.ceil(maximum * .2).toInt())
    fun restore(current: Int): Int? = if (raised != original && current == raised) original else null
}
