package dev.tvcall.tv

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.View
import android.view.Window
import android.widget.*

/** Presentation shared only by TV screens. Phone layouts keep their own styling. */
internal object TvUi {
    val ink = Color.rgb(244, 248, 240)
    val muted = Color.rgb(159, 183, 171)
    val accent = Color.rgb(218, 241, 191)
    private val surface = Color.rgb(23, 43, 35)
    private val border = Color.rgb(48, 73, 59)
    fun dp(c: Context, value: Int) = (value * c.resources.displayMetrics.density).toInt()
    fun shape(c: Context, color: Int, radius: Int = 18, stroke: Int = border) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(c, radius).toFloat(); setStroke(dp(c, 1), stroke)
    }
    fun screen(c: Context) = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(c, 52), dp(c, 28), dp(c, 52), dp(c, 28))
        background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.rgb(10, 24, 18), Color.rgb(20, 43, 32)))
    }
    fun text(c: Context, label: String, size: Float = 16f, secondary: Boolean = false) = TextView(c).apply {
        text = label; textSize = size; setTextColor(if (secondary) muted else ink)
        typeface = Typeface.create("sans-serif", Typeface.NORMAL)
        setLineSpacing(dp(c, 3).toFloat(), 1f)
    }
    fun heading(c: Context, label: String, size: Float = 36f) = text(c, label, size).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }
    fun space(c: Context, height: Int) = View(c).apply { layoutParams = LinearLayout.LayoutParams(1, dp(c, height)) }
    fun card(c: Context) = LinearLayout(c).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(c, 26), dp(c, 24), dp(c, 26), dp(c, 24))
        background = shape(c, surface, 22); elevation = dp(c, 5).toFloat()
    }
    fun button(c: Context, label: String, primary: Boolean = false, danger: Boolean = false, click: () -> Unit) = Button(c).apply {
        text = label; textSize = 16f; isAllCaps = false
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        gravity = Gravity.CENTER; isFocusable = true; isFocusableInTouchMode = true
        minHeight = dp(c, 52); minimumHeight = dp(c, 52)
        setPadding(dp(c, 22), dp(c, 10), dp(c, 22), dp(c, 10))
        background = StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), shape(c, surface, 12))
            addState(intArrayOf(android.R.attr.state_focused), shape(c, if (danger) Color.rgb(162, 67, 72) else accent, 12, ink))
            addState(intArrayOf(android.R.attr.state_pressed), shape(c, accent, 12, ink))
            addState(intArrayOf(), shape(c, if (primary) accent else if (danger) Color.rgb(61, 35, 38) else Color.rgb(33, 57, 44), 12))
        }
        setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf(android.R.attr.state_focused), intArrayOf()),
            intArrayOf(muted, if (danger) ink else Color.rgb(19, 44, 28), if (primary) Color.rgb(19, 44, 28) else ink)))
        setOnFocusChangeListener { _, focused ->
            animate().scaleX(if (focused) 1.025f else 1f).scaleY(if (focused) 1.025f else 1f).setDuration(120).start()
            elevation = dp(c, if (focused) 7 else 0).toFloat()
        }
        setOnClickListener { click() }
    }
    fun input(c: Context, label: String, value: String) = EditText(c).apply {
        hint = label; setText(value); setSingleLine(true); textSize = 18f
        setTextColor(ink); setHintTextColor(muted); setPadding(dp(c, 16), dp(c, 12), dp(c, 16), dp(c, 12))
        background = shape(c, Color.rgb(12, 30, 22), 12)
        setOnFocusChangeListener { _, focused -> background = shape(c, Color.rgb(12, 30, 22), 12, if (focused) accent else border) }
    }
    fun brand(c: Context, onHold: (() -> Unit)? = null) = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        addView(Mark(c), LinearLayout.LayoutParams(dp(c, 36), dp(c, 36)))
        addView(heading(c, "HomePing", 22f).apply { setPadding(dp(c, 10), 0, 0, 0) })
        if (onHold != null) {
            isFocusable = true; setOnLongClickListener { onHold(); true }
            setOnFocusChangeListener { _, focused -> alpha = if (focused) .72f else 1f }
        }
    }
    fun loading(activity: Activity, label: String): Dialog = Dialog(activity).apply {
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        val row = card(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row.addView(ProgressBar(activity).apply { indeterminateTintList = ColorStateList.valueOf(accent) }, LinearLayout.LayoutParams(dp(activity, 26), dp(activity, 26)))
        row.addView(text(activity, label).apply { setPadding(dp(activity, 18), 0, 0, 0) })
        setContentView(row); setCancelable(false)
        window?.setBackgroundDrawableResource(android.R.color.transparent)
        show(); window?.setLayout(dp(activity, 340), -2)
    }
    data class IncomingCard(val panel: LinearLayout, val accept: Button, val reject: Button)
    fun incoming(c: Context, accept: () -> Unit, reject: () -> Unit): IncomingCard {
        val panel = card(c)
        panel.gravity = Gravity.CENTER_HORIZONTAL
        panel.addView(brand(c))
        panel.addView(space(c, 26))
        panel.addView(text(c, "INCOMING CALL", 12f, true).apply { letterSpacing = .16f })
        panel.addView(space(c, 8))
        panel.addView(heading(c, "A little closer to home.", 27f).apply { gravity = Gravity.CENTER })
        panel.addView(space(c, 10))
        panel.addView(text(c, "Your HomePing account is calling this TV.", 15f, true).apply { gravity = Gravity.CENTER })
        panel.addView(space(c, 28))
        val actions = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL }
        val yes = button(c, "Accept", primary = true, click = accept)
        actions.addView(yes, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(c, 12) })
        val no = button(c, "Reject", danger = true, click = reject)
        actions.addView(no, LinearLayout.LayoutParams(0, -2, 1f))
        panel.addView(actions, LinearLayout.LayoutParams(-1, -2))
        panel.addView(space(c, 14))
        panel.addView(text(c, "Choose with your remote", 12f, true))
        return IncomingCard(panel, yes, no)
    }
    class Mark(c: Context) : View(c) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            canvas.save(); canvas.scale(width / 96f, height / 96f)
            paint.style = Paint.Style.FILL; paint.color = accent
            canvas.drawRoundRect(0f, 0f, 96f, 96f, 26f, 26f, paint)
            paint.style = Paint.Style.STROKE; paint.color = Color.rgb(24, 61, 40); paint.strokeWidth = 5f; paint.strokeCap = Paint.Cap.ROUND; paint.strokeJoin = Paint.Join.ROUND
            val roof = Path().apply { moveTo(21f, 43f); lineTo(48f, 21f); lineTo(75f, 43f) }; canvas.drawPath(roof, paint)
            val home = Path().apply { moveTo(27f, 40f); lineTo(27f, 72f); quadTo(27f, 77f, 32f, 77f); lineTo(64f, 77f); quadTo(69f, 77f, 69f, 72f); lineTo(69f, 40f) }; canvas.drawPath(home, paint)
            canvas.drawRoundRect(38f, 48f, 59f, 63f, 4f, 4f, paint)
            paint.style = Paint.Style.FILL; canvas.drawCircle(74f, 22f, 7f, paint)
            canvas.restore()
        }
    }
}
