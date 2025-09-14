// Navigation mobile
document.addEventListener('DOMContentLoaded', function() {
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');

    // Toggle mobile menu
    hamburger.addEventListener('click', function() {
        hamburger.classList.toggle('active');
        navMenu.classList.toggle('active');
    });

    // Close mobile menu when clicking on a link
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
        });
    });

    // Smooth scrolling for navigation links (sécurisé)
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            // Scroll fluide UNIQUEMENT pour les ancres internes
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const targetSection = document.querySelector(href);
                if (targetSection) {
                    const offsetTop = targetSection.offsetTop - 80; // Account for fixed header
                    window.scrollTo({
                        top: offsetTop,
                        behavior: 'smooth'
                    });
                }
            }
            // Pour tout autre lien (ex: contact.html), navigation normale
        }, false);
    });

    // Header background on scroll
    const header = document.querySelector('.header');
    window.addEventListener('scroll', function() {
        if (window.scrollY > 100) {
            header.style.background = 'rgba(255, 255, 255, 0.98)';
            header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.15)';
        } else {
            header.style.background = 'rgba(255, 255, 255, 0.95)';
            header.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.1)';
        }
    });

    // Intersection Observer for animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe elements for animation
    const animatedElements = document.querySelectorAll('.service-card, .project-card, .stat-item');
    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // Counter animation for stats
    const statNumbers = document.querySelectorAll('.stat-item h3');
    const statsSection = document.querySelector('.stats');

    const statsObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                statNumbers.forEach(stat => {
                    const target = parseInt(stat.textContent.replace('+', ''));
                    animateCounter(stat, target);
                });
                statsObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    statsObserver.observe(statsSection);

    // Counter animation function
    function animateCounter(element, target) {
        let current = 0;
        const increment = target / 50;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                current = target;
                clearInterval(timer);
            }
            element.textContent = '+' + Math.floor(current);
        }, 30);
    }

    // Form handling for contact/devis
    const contactForms = document.querySelectorAll('form');
    contactForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(form);
            const data = Object.fromEntries(formData);
            
            // Simple validation
            let isValid = true;
            Object.keys(data).forEach(key => {
                if (!data[key] || data[key].trim() === '') {
                    isValid = false;
                }
            });
            
            if (isValid) {
                // Show success message
                showNotification('Message envoyé avec succès!', 'success');
                form.reset();
            } else {
                showNotification('Veuillez remplir tous les champs', 'error');
            }
        });
    });

    // Notification system
    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.right = '20px';
        notification.style.padding = '15px 20px';
        notification.style.borderRadius = '5px';
        notification.style.color = 'white';
        notification.style.fontWeight = '600';
        notification.style.zIndex = '10000';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'transform 0.3s ease';
        
        if (type === 'success') {
            notification.style.background = '#28a745';
        } else if (type === 'info') {
            notification.style.background = '#17a2b8';
        } else {
            notification.style.background = '#dc3545';
        }
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    // Service modal system
    function showServiceModal(title, description) {
        // Créer l'overlay
        const overlay = document.createElement('div');
        overlay.className = 'service-modal-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

        // Créer la modal
        const modal = document.createElement('div');
        modal.className = 'service-modal';
        modal.style.cssText = `
            background: white;
            border-radius: 15px;
            padding: 30px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            position: relative;
            transform: scale(0.8);
            transition: transform 0.3s ease;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        `;

        // Contenu de la modal
        modal.innerHTML = `
            <button class="modal-close" style="
                position: absolute;
                top: 15px;
                right: 20px;
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: #666;
                transition: color 0.3s ease;
            ">&times;</button>
            <div class="modal-content">
                <h2 style="
                    color: #1a5f7a;
                    margin-bottom: 20px;
                    font-size: 28px;
                    font-weight: 700;
                ">${title}</h2>
                <div class="modal-description" style="
                    color: #333;
                    line-height: 1.6;
                    margin-bottom: 25px;
                    font-size: 16px;
                ">${getDetailedServiceDescription(title)}</div>
                <div class="modal-features" style="
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 25px;
                ">
                    <h3 style="color: #1a5f7a; margin-bottom: 15px; font-size: 20px;">Nos Expertises</h3>
                    <ul style="list-style: none; padding: 0;">
                        ${getServiceFeatures(title)}
                    </ul>
                </div>
                <div class="modal-cta" style="text-align: center;">
                    <a href="contact.html" style="
                        display: inline-block;
                        background: linear-gradient(135deg, #1a5f7a, #2c88a8);
                        color: white;
                        padding: 15px 30px;
                        border-radius: 25px;
                        text-decoration: none;
                        font-weight: 600;
                        transition: transform 0.3s ease;
                        box-shadow: 0 4px 15px rgba(26, 95, 122, 0.3);
                    ">Demander un Devis</a>
                </div>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Animer l'ouverture
        setTimeout(() => {
            overlay.style.opacity = '1';
            modal.style.transform = 'scale(1)';
        }, 10);

        // Gestionnaire de fermeture
        const closeModal = () => {
            overlay.style.opacity = '0';
            modal.style.transform = 'scale(0.8)';
            setTimeout(() => {
                document.body.removeChild(overlay);
            }, 300);
        };

        // Événements de fermeture
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeModal();
            }
        });

        // Fermeture avec Escape
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Hover effect sur le bouton CTA
        const ctaButton = modal.querySelector('.modal-cta a');
        ctaButton.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        ctaButton.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    }

    // Fonction pour obtenir la description détaillée du service
    function getDetailedServiceDescription(serviceTitle) {
        const descriptions = {
            'Structure du Bâtiment': `
                <p>Notre expertise en structure du bâtiment couvre tous les aspects de l'ingénierie structurelle moderne. Nous concevons et calculons des structures robustes, durables et économiques.</p>
                <p>Nos ingénieurs maîtrisent les dernières normes de construction et utilisent des logiciels de pointe pour garantir la sécurité et l'optimisation de vos projets.</p>
            `,
            'Lots Techniques du Bâtiment': `
                <p>Nous nous spécialisons dans la conception et l'optimisation des systèmes techniques du bâtiment. Notre approche intègre l'efficacité énergétique et le confort des occupants.</p>
                <p>De la climatisation à la ventilation, en passant par les réseaux de fluides, nous assurons une coordination parfaite entre tous les lots techniques.</p>
            `,
            'VRD': `
                <p>Nos services VRD (Voirie et Réseaux Divers) couvrent la conception complète des infrastructures extérieures. Nous optimisons la circulation et l'accessibilité de vos projets.</p>
                <p>De l'éclairage public à l'électrification extérieure, nous créons des espaces fonctionnels et esthétiques qui s'intègrent parfaitement à l'environnement urbain.</p>
            `
        };
        return descriptions[serviceTitle] || `<p>${serviceTitle} - Service professionnel de haute qualité pour tous vos besoins en ingénierie.</p>`;
    }

    // Fonction pour obtenir les fonctionnalités du service
    function getServiceFeatures(serviceTitle) {
        const features = {
            'Structure du Bâtiment': [
                'Calcul de structures en béton armé',
                'Conception de structures métalliques',
                'Analyse sismique et parasismique',
                'Dimensionnement des fondations',
                'Études de stabilité et de résistance',
                'Optimisation des coûts de construction'
            ],
            'Lots Techniques du Bâtiment': [
                'Conception CVC (Chauffage, Ventilation, Climatisation)',
                'Réseaux de fluides (eau, gaz, électricité)',
                'Études thermiques et énergétiques',
                'Systèmes de sécurité incendie',
                'Automatisation et domotique',
                'Certification énergétique'
            ],
            'VRD': [
                'Conception de voirie et espaces publics',
                'Éclairage public et signalisation',
                'Réseaux d'assainissement et eaux pluviales',
                'Électrification extérieure',
                'Aménagement paysager technique',
                'Accessibilité PMR et normes'
            ]
        };
        
        const serviceFeatures = features[serviceTitle] || ['Service professionnel', 'Expertise technique', 'Accompagnement personnalisé'];
        
        return serviceFeatures.map(feature => `
            <li style="
                padding: 8px 0;
                border-bottom: 1px solid #e9ecef;
                position: relative;
                padding-left: 25px;
            ">
                <i class="fas fa-check" style="
                    color: #28a745;
                    position: absolute;
                    left: 0;
                    top: 8px;
                "></i>
                ${feature}
            </li>
        `).join('');
    }

    // Lazy loading for images (if any are added later)
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });

    images.forEach(img => imageObserver.observe(img));

    // Parallax effect for hero section
    const hero = document.querySelector('.hero');
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const rate = scrolled * -0.5;
        hero.style.transform = `translateY(${rate}px)`;
    });

    // Add loading animation
    window.addEventListener('load', function() {
        document.body.classList.add('loaded');
    });

    // Service card hover effects
    const serviceCards = document.querySelectorAll('.service-card');
    serviceCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-15px) scale(1.02)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });

    // Project card click handlers
    const projectCards = document.querySelectorAll('.project-card');
    projectCards.forEach(card => {
        card.addEventListener('click', function() {
            const projectName = this.querySelector('h4').textContent;
            showNotification(`Projet ${projectName} - Détails à venir`, 'info');
        });
    });

    // Service "Voir Plus" button handlers
    const serviceLinks = document.querySelectorAll('.service-link');
    serviceLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const serviceCard = this.closest('.service-card');
            const serviceTitle = serviceCard.querySelector('h3').textContent;
            const serviceDescription = serviceCard.querySelector('p').textContent;
            
            // Créer une modal avec les détails du service
            showServiceModal(serviceTitle, serviceDescription);
        });
    });

    // Back to top button
    const backToTopBtn = document.createElement('button');
    backToTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    backToTopBtn.className = 'back-to-top';
    backToTopBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #1a5f7a, #2c88a8);
        color: white;
        border: none;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        z-index: 1000;
        box-shadow: 0 4px 15px rgba(26, 95, 122, 0.3);
    `;
    
    document.body.appendChild(backToTopBtn);
    
    // Show/hide back to top button
    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            backToTopBtn.style.opacity = '1';
            backToTopBtn.style.visibility = 'visible';
        } else {
            backToTopBtn.style.opacity = '0';
            backToTopBtn.style.visibility = 'hidden';
        }
    });
    
    // Back to top functionality
    backToTopBtn.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Add CSS for mobile menu
    const style = document.createElement('style');
    style.textContent = `
        @media (max-width: 768px) {
            .nav-menu {
                position: fixed;
                left: -100%;
                top: 70px;
                flex-direction: column;
                background-color: white;
                width: 100%;
                text-align: center;
                transition: 0.3s;
                box-shadow: 0 10px 27px rgba(0, 0, 0, 0.05);
                padding: 2rem 0;
            }
            
            .nav-menu.active {
                left: 0;
            }
            
            .nav-menu li {
                margin: 1rem 0;
            }
            
            .hamburger.active span:nth-child(2) {
                opacity: 0;
            }
            
            .hamburger.active span:nth-child(1) {
                transform: translateY(8px) rotate(45deg);
            }
            
            .hamburger.active span:nth-child(3) {
                transform: translateY(-8px) rotate(-45deg);
            }
        }
        
        .back-to-top:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 20px rgba(26, 95, 122, 0.4);
        }
        
        body.loaded {
            opacity: 1;
        }
        
        body {
            opacity: 0;
            transition: opacity 0.5s ease;
        }
    `;
    document.head.appendChild(style);
});

// Preloader (optional)
window.addEventListener('load', function() {
    const preloader = document.querySelector('.preloader');
    if (preloader) {
        preloader.style.opacity = '0';
        setTimeout(() => {
            preloader.style.display = 'none';
        }, 500);
    }
}); 

// --- Loupe de zoom sur toutes les images de projets du site (.project-gallery-row img et .project-img-container img) ---
document.addEventListener('DOMContentLoaded', function () {
  const galleryImages = document.querySelectorAll('.project-gallery-row img, .project-img-container img');

  galleryImages.forEach(img => {
    // Créer la loupe
    const magnifier = document.createElement('div');
    magnifier.classList.add('magnifier-glass');
    // S'assurer que le parent est positionné en relative
    const parent = img.parentElement;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(magnifier);

    let zoom = 2;
    let magnifierSize = 120;

    img.addEventListener('mousemove', moveMagnifier);
    img.addEventListener('mouseenter', showMagnifier);
    img.addEventListener('mouseleave', hideMagnifier);

    function showMagnifier(e) {
      magnifier.style.display = 'block';
      magnifier.style.backgroundImage = `url('${img.src}')`;
    }
    function hideMagnifier(e) {
      magnifier.style.display = 'none';
    }
    function moveMagnifier(e) {
      const rect = img.getBoundingClientRect();
      // Position du curseur par rapport à l'image, même avec scroll
      let x = e.pageX - window.scrollX - rect.left;
      let y = e.pageY - window.scrollY - rect.top;
      // Calculer la position idéale (sous le curseur)
      let left = x - magnifierSize / 2;
      let top = y - magnifierSize / 2;
      // Si la loupe sort, la coller au bord
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left > img.width - magnifierSize) left = img.width - magnifierSize;
      if (top > img.height - magnifierSize) top = img.height - magnifierSize;
      magnifier.style.left = left + 'px';
      magnifier.style.top = top + 'px';
      // Déplacer l'arrière-plan pour l'effet de zoom
      const bgX = ((x / img.width) * 100);
      const bgY = ((y / img.height) * 100);
      magnifier.style.backgroundSize = `${img.width * zoom}px ${img.height * zoom}px`;
      magnifier.style.backgroundPosition = `${bgX}% ${bgY}%`;
    }
  });
}); 