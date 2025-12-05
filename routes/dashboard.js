// backend/routes/analytics.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { verifyToken, authorizeAdmin } = require('../middleware/auth');

router.get("/resumen", verifyToken, authorizeAdmin, async (req, res) => {
    try {
        const [ventasTotales, pedidosTotal, usuariosNuevos, arrendamientosActivos] = await Promise.all([
            db.query(`
                SELECT 
                    COALESCE(SUM(total), 0) as total,
                    COUNT(*) as cantidad,
                    COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE) THEN total ELSE 0 END), 0) as mes_actual,
                    COALESCE(SUM(CASE WHEN fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') 
                        AND fecha_creacion < DATE_TRUNC('month', CURRENT_DATE) THEN total ELSE 0 END), 0) as mes_anterior
                FROM ventas 
                WHERE estado_pago = 'completado'
                    AND fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
            `),
            db.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END) as mes_actual,
                    COUNT(CASE WHEN fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') 
                        AND fecha_creacion < DATE_TRUNC('month', CURRENT_DATE) THEN 1 END) as mes_anterior
                FROM ventas
                WHERE fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
            `),
            db.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN created_at >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END) as mes_actual,
                    COUNT(CASE WHEN created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') 
                        AND created_at < DATE_TRUNC('month', CURRENT_DATE) THEN 1 END) as mes_anterior
                FROM users
                WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
            `),
            db.query(`
                SELECT 
                    COUNT(DISTINCT v.id) as total,
                    COUNT(DISTINCT CASE WHEN v.fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE) THEN v.id END) as mes_actual,
                    COUNT(DISTINCT CASE WHEN v.fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') 
                        AND v.fecha_creacion < DATE_TRUNC('month', CURRENT_DATE) THEN v.id END) as mes_anterior
                FROM ventas v
                JOIN venta_detalles dv ON v.id = dv.venta_id
                WHERE dv.es_arrendamiento = true
                    AND v.fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
            `)
        ]);

        const calcularCambio = (actual, anterior) => {
            if (anterior === 0) return actual > 0 ? 100 : 0;
            return ((actual - anterior) / anterior * 100).toFixed(1);
        };

        const stats = {
            ventas_totales: {
                value: ventasTotales.rows[0].mes_actual,
                change: calcularCambio(
                    parseFloat(ventasTotales.rows[0].mes_actual), 
                    parseFloat(ventasTotales.rows[0].mes_anterior)
                ),
                trend: parseFloat(ventasTotales.rows[0].mes_actual) >= parseFloat(ventasTotales.rows[0].mes_anterior) ? 'up' : 'down'
            },
            pedidos: {
                value: parseInt(pedidosTotal.rows[0].mes_actual),
                change: calcularCambio(
                    parseInt(pedidosTotal.rows[0].mes_actual), 
                    parseInt(pedidosTotal.rows[0].mes_anterior)
                ),
                trend: parseInt(pedidosTotal.rows[0].mes_actual) >= parseInt(pedidosTotal.rows[0].mes_anterior) ? 'up' : 'down'
            },
            usuarios_nuevos: {
                value: parseInt(usuariosNuevos.rows[0].mes_actual),
                change: calcularCambio(
                    parseInt(usuariosNuevos.rows[0].mes_actual), 
                    parseInt(usuariosNuevos.rows[0].mes_anterior)
                ),
                trend: parseInt(usuariosNuevos.rows[0].mes_actual) >= parseInt(usuariosNuevos.rows[0].mes_anterior) ? 'up' : 'down'
            },
            arrendamientos_activos: {
                value: parseInt(arrendamientosActivos.rows[0].mes_actual),
                change: calcularCambio(
                    parseInt(arrendamientosActivos.rows[0].mes_actual), 
                    parseInt(arrendamientosActivos.rows[0].mes_anterior)
                ),
                trend: parseInt(arrendamientosActivos.rows[0].mes_actual) >= parseInt(arrendamientosActivos.rows[0].mes_anterior) ? 'up' : 'down'
            }
        };

        res.json({ success: true, stats });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo resumen" });
    }
});

router.get("/ventas-mensuales", verifyToken, authorizeAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                TO_CHAR(DATE_TRUNC('month', fecha_creacion), 'Mon') as mes,
                COALESCE(SUM(total), 0) as ventas,
                COUNT(*) as pedidos
            FROM ventas
            WHERE estado_pago = 'completado'
                AND fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months')
            GROUP BY DATE_TRUNC('month', fecha_creacion)
            ORDER BY DATE_TRUNC('month', fecha_creacion) ASC
        `);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo ventas mensuales" });
    }
});

router.get("/ingresos-semanales", verifyToken, authorizeAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                TO_CHAR(fecha_creacion, 'DD/MM') as fecha,
                COALESCE(SUM(total), 0) as ingresos
            FROM ventas
            WHERE estado_pago = 'completado'
                AND fecha_creacion >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY fecha_creacion
            ORDER BY fecha_creacion ASC
        `);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo ingresos semanales" });
    }
});

router.get("/ventas-por-categoria", verifyToken, authorizeAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                c.nombre as name,
                COUNT(DISTINCT v.id) as value
            FROM categorias c
            JOIN productos p ON c.id = p.categoria_id
            JOIN venta_detalles dv ON p.id = dv.producto_id
            JOIN ventas v ON dv.venta_id = v.id
            WHERE v.estado_pago = 'completado'
                AND v.fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE)
            GROUP BY c.nombre
            ORDER BY value DESC
            LIMIT 5
        `);

        const colores = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'];
        const dataConColores = result.rows.map((item, index) => ({
            ...item,
            color: colores[index] || '#6b7280'
        }));

        res.json({ success: true, data: dataConColores });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo ventas por categoría" });
    }
});

router.get("/pedidos-recientes", verifyToken, authorizeAdmin, async (req, res) => {
    const { limite = 5 } = req.query;
    try {
        const result = await db.query(`
            SELECT 
                v.id,
                v.numero_orden as id_orden,
                u.first_name || ' ' || u.last_name as cliente,
                v.total,
                v.estado_orden as estado,
                TO_CHAR(v.fecha_creacion, 'YYYY-MM-DD') as fecha
            FROM ventas v
            JOIN users u ON v.cliente_id = u.id
            ORDER BY v.fecha_creacion DESC
            LIMIT $1
        `, [limite]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo pedidos recientes" });
    }
});

router.get("/productos-bajo-stock", verifyToken, authorizeAdmin, async (req, res) => {
    const { limite = 10 } = req.query;
    try {
        const result = await db.query(`
            SELECT 
                id,
                nombre,
                stock
            FROM productos
            WHERE stock <= 10 AND activo = true
            ORDER BY (10 - stock) DESC
            LIMIT $1
        `, [limite]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo productos bajo stock" });
    }
});

router.get("/resumen-dia", verifyToken, authorizeAdmin, async (req, res) => {
    try {
        const [pedidosHoy, ingresosHoy, usuariosNuevos] = await Promise.all([
            db.query(`
                SELECT COUNT(*) as total
                FROM ventas
                WHERE DATE(fecha_creacion) = CURRENT_DATE
            `),
            db.query(`
                SELECT COALESCE(SUM(total), 0) as total
                FROM ventas
                WHERE estado_pago = 'completado'
                    AND DATE(fecha_creacion) = CURRENT_DATE
            `),
            db.query(`
                SELECT COUNT(*) as total
                FROM users
                WHERE DATE(created_at) = CURRENT_DATE
            `)
        ]);

        const data = {
            pedidos_hoy: parseInt(pedidosHoy.rows[0].total),
            ingresos_hoy: parseFloat(ingresosHoy.rows[0].total),
            usuarios_nuevos: parseInt(usuariosNuevos.rows[0].total)
        };

        res.json({ success: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo resumen del día" });
    }
});


router.get("/alertas", verifyToken, authorizeAdmin, async (req, res) => {
    try {
        const [productosCriticos, metaVentas] = await Promise.all([
            db.query(`
                SELECT COUNT(*) as total
                FROM productos
                WHERE stock < 5 AND activo = true
            `),
            db.query(`
                SELECT 
                    COALESCE(SUM(total), 0) as ventas_mes,
                    30000 as meta_mensual
                FROM ventas
                WHERE estado_pago = 'completado'
                    AND fecha_creacion >= DATE_TRUNC('month', CURRENT_DATE)
            `)
        ]);

        const ventasMes = parseFloat(metaVentas.rows[0].ventas_mes);
        const metaMensual = parseFloat(metaVentas.rows[0].meta_mensual);
        const porcentajeMeta = ((ventasMes / metaMensual) * 100).toFixed(0);
        const faltante = (metaMensual - ventasMes).toFixed(2);

        const alertas = [
            {
                tipo: 'warning',
                titulo: `${productosCriticos.rows[0].total} productos con stock crítico`,
                descripcion: 'Requieren atención inmediata'
            },
            {
                tipo: 'info',
                titulo: `Meta de ventas alcanzada al ${porcentajeMeta}%`,
                descripcion: `Faltan $${faltante} para la meta mensual`
            }
        ];

        res.json({ success: true, alertas });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: "Error obteniendo alertas" });
    }
});

module.exports = router;
